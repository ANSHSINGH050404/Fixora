import { describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { SettingsPutBody } from "../src/server/domain/settings";
import { SettingsError } from "../src/server/domain/errors";
import { decryptSetting, encryptSetting } from "../src/server/services/secrets";
import { SettingsService } from "../src/server/services/settings";
import { SettingsStore, SettingsStoreMemoryLive } from "../src/server/services/settings-store";
import { makeAppConfigLayer } from "../src/server/services/config";
import { LLMService } from "../src/server/services/llm";
import { testEnv } from "./helpers";

const withSecret = async <T>(secret: string | undefined, run: () => Promise<T>): Promise<T> => {
  const prev = process.env.SETTINGS_SECRET;
  try {
    if (secret === undefined) delete process.env.SETTINGS_SECRET;
    else process.env.SETTINGS_SECRET = secret;
    return await run();
  } finally {
    if (prev === undefined) delete process.env.SETTINGS_SECRET;
    else process.env.SETTINGS_SECRET = prev;
  }
};

describe("settings crypto", () => {
  test("encrypt/decrypt roundtrip", async () => {
    await withSecret("test-master-secret", async () => {
      const stored = await Effect.runPromise(encryptSetting("sk-test-123"));
      expect(stored.startsWith("v1:")).toBe(true);
      expect(stored).not.toContain("sk-test-123");
      const back = await Effect.runPromise(decryptSetting(stored));
      expect(back).toBe("sk-test-123");
    });
  });

  test("encryption fails closed without SETTINGS_SECRET", async () => {
    await withSecret(undefined, async () => {
      const err = await Effect.runPromise(Effect.flip(encryptSetting("x")));
      expect(err).toBeInstanceOf(SettingsError);
    });
  });

  test("decryption fails with the wrong master secret", async () => {
    let stored = "";
    await withSecret("correct-secret", async () => {
      stored = await Effect.runPromise(encryptSetting("sk-test-123"));
    });
    await withSecret("wrong-secret", async () => {
      const err = await Effect.runPromise(Effect.flip(decryptSetting(stored)));
      expect(err).toBeInstanceOf(SettingsError);
    });
  });
});

describe("settings validation", () => {
  const decode = (body: unknown) => Schema.decodeUnknownEither(SettingsPutBody)(body);

  test("accepts a valid partial body", () => {
    const r = decode({ LLM_MODEL: "gemini-3.5-flash", MAX_REPAIR_ATTEMPTS: 5 });
    expect(r._tag).toBe("Right");
  });

  test("rejects non-URL base, out-of-range numbers", () => {
    expect(decode({ LLM_BASE_URL: "not-a-url" })._tag).toBe("Left");
    expect(decode({ SANDBOX_TIMEOUT_MS: 5 })._tag).toBe("Left");
    expect(decode({ SANDBOX_TIMEOUT_MS: 9_999_999 })._tag).toBe("Left");
    expect(decode({ MAX_REPAIR_ATTEMPTS: 0 })._tag).toBe("Left");
    expect(decode({ MAX_REPAIR_ATTEMPTS: 99 })._tag).toBe("Left");
    expect(decode({ LLM_API_KEY: "" })._tag).toBe("Left");
  });
});

describe("settings service", () => {
  const TestEnv = testEnv(makeAppConfigLayer({ llmModel: "env-model" }));
  const run = <A, E>(eff: Effect.Effect<A, E, SettingsService | SettingsStore>) =>
    Effect.runPromise(eff.pipe(Effect.provide(Layer.mergeAll(TestEnv, SettingsStoreMemoryLive))));

  test("db overrides beat env; unknown stored keys are ignored", async () => {
    await run(
      Effect.gen(function* () {
        const svc = yield* SettingsService;
        const store = yield* SettingsStore;
        // Non-secret override, no master secret needed.
        yield* svc.setMany({ LLM_MODEL: "db-model", SANDBOX_TIMEOUT_MS: 60_000 });
        // Junk key written out-of-band must never surface.
        yield* store.setRaw("EVIL_KEY", "x");
        const effective = yield* svc.getEffective();
        expect(effective.llmModel).toBe("db-model");
        expect(effective.sandboxTimeoutMs).toBe(60_000);
        const described = yield* svc.describe();
        expect(described.some((d) => d.key === ("EVIL_KEY" as never))).toBe(false);
        const model = described.find((d) => d.key === "LLM_MODEL")!;
        expect(model.source).toBe("db");
        expect(model.value).toBe("db-model");
        yield* svc.clear("LLM_MODEL");
        const after = yield* svc.getEffective();
        expect(after.llmModel).toBe("env-model");
      }),
    );
  });

  test("secrets are encrypted, redacted, and fail closed without master secret", async () => {
    await withSecret("svc-master", async () => {
      await run(
        Effect.gen(function* () {
          const svc = yield* SettingsService;
          const store = yield* SettingsStore;
          yield* svc.setMany({ LLM_API_KEY: "sk-live-abc" });
          const raw = yield* store.getAllRaw();
          expect(raw["LLM_API_KEY"].startsWith("v1:")).toBe(true);
          expect(raw["LLM_API_KEY"]).not.toContain("sk-live-abc");
          const effective = yield* svc.getEffective();
          expect(effective.llmApiKey).toBe("sk-live-abc");
          const described = yield* svc.describe();
          const entry = described.find((d) => d.key === "LLM_API_KEY")!;
          expect(entry.configured).toBe(true);
          expect(entry.source).toBe("db");
          expect("value" in entry && entry.value !== undefined).toBe(false);
          yield* svc.clear("LLM_API_KEY");
        }),
      );
    });
    await withSecret(undefined, async () => {
      const err = await Effect.runPromise(
        Effect.flatMap(SettingsService, (s) => s.setMany({ GITHUB_TOKEN: "x" })).pipe(
          Effect.provide(Layer.mergeAll(TestEnv, SettingsStoreMemoryLive)),
          Effect.flip,
        ),
      );
      expect(err).toBeInstanceOf(SettingsError);
    });
  });

  test("LLM service picks up settings changes without a rebuild (hot-apply)", async () => {
    await withSecret("hot-master", async () => {
      const Live = Layer.mergeAll(
        TestEnv,
        SettingsStoreMemoryLive,
        LLMService.Default.pipe(Layer.provide(TestEnv)),
      );
      const prog = Effect.gen(function* () {
        const svc = yield* SettingsService;
        const llm = yield* LLMService;
        expect(yield* llm.isEnabled).toBe(false);
        yield* svc.setMany({
          LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
          LLM_MODEL: "gemini-3.5-flash",
          LLM_API_KEY: "sk-hot-test",
        });
        // Same layer instances, new behavior — no restart, no rebuild.
        expect(yield* llm.isEnabled).toBe(true);
        expect(yield* llm.modelName).toBe("gemini-3.5-flash");
        yield* svc.clear("LLM_API_KEY");
        yield* svc.clear("LLM_BASE_URL");
        yield* svc.clear("LLM_MODEL");
        expect(yield* llm.isEnabled).toBe(false);
      });
      await Effect.runPromise(prog.pipe(Effect.provide(Live)));
    });
  });
});
