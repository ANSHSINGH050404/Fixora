import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Context, Effect, Layer, Ref } from "effect";
import postgres from "postgres";
import * as schema from "../db/schema";
import { SettingsError } from "../domain/errors";
import { AppConfigService } from "./config";

export interface SettingsStoreApi {
  /** All raw stored overrides (decryption is the caller's job). */
  readonly getAllRaw: () => Effect.Effect<Record<string, string>, SettingsError>;
  readonly setRaw: (key: string, value: string) => Effect.Effect<void, SettingsError>;
  readonly delete: (key: string) => Effect.Effect<void, SettingsError>;
}

export class SettingsStore extends Context.Tag("SettingsStore")<
  SettingsStore,
  SettingsStoreApi
>() {}

const fail = (operation: string, message: unknown): SettingsError =>
  new SettingsError({
    message: message instanceof Error ? message.message : String(message),
  });

/** Ephemeral backend (no DATABASE_URL): overrides live in process memory. */
export const SettingsStoreMemoryLive: Layer.Layer<SettingsStore> = Layer.effect(
  SettingsStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make<Record<string, string>>({});
    return {
      getAllRaw: () => Ref.get(ref),
      setRaw: (key, value) => Ref.update(ref, (s) => ({ ...s, [key]: value })),
      delete: (key) =>
        Ref.update(ref, (s) => {
          const next = { ...s };
          delete next[key];
          return next;
        }),
    } satisfies SettingsStoreApi;
  }),
);

/** PostgreSQL backend. Requires DATABASE_URL. */
export const SettingsStorePostgresLive: Layer.Layer<SettingsStore, never, AppConfigService> =
  Layer.effect(
    SettingsStore,
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      if (!config.databaseUrl) {
        return yield* Effect.die(
          new Error("SettingsStorePostgresLive requires DATABASE_URL"),
        );
      }
      const client = postgres(config.databaseUrl, { max: 5 });
      const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });

      const wrap = <A>(operation: string, run: Promise<A>) =>
        Effect.tryPromise({
          try: () => run,
          catch: (e) => fail(operation, e),
        });

      return {
        getAllRaw: () =>
          Effect.gen(function* () {
            const rows = yield* wrap("settings.getAll", db.select().from(schema.appSettings));
            const out: Record<string, string> = {};
            for (const r of rows) out[r.key] = r.value;
            return out;
          }),
        setRaw: (key, value) =>
          Effect.as(
            wrap(
              "settings.set",
              db
                .insert(schema.appSettings)
                .values({ key, value, updatedAt: new Date() })
                .onConflictDoUpdate({
                  target: schema.appSettings.key,
                  set: { value, updatedAt: new Date() },
                }),
            ),
            undefined,
          ),
        delete: (key) =>
          Effect.as(
            wrap("settings.delete", db.delete(schema.appSettings).where(eq(schema.appSettings.key, key))),
            undefined,
          ),
      } satisfies SettingsStoreApi;
    }),
  );

/** Picks Postgres when DATABASE_URL is set, otherwise the ephemeral memory store. */
export const SettingsStoreLive: Layer.Layer<SettingsStore, never, AppConfigService> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      if (config.databaseUrl) {
        yield* Effect.logInfo("SettingsStore: using PostgreSQL backend");
        return SettingsStorePostgresLive;
      }
      yield* Effect.logWarning(
        "SettingsStore: DATABASE_URL unset — settings overrides will not survive restarts",
      );
      return SettingsStoreMemoryLive;
    }),
  );
