import { Effect } from "effect";
import { Octokit } from "octokit";
import {
  EDITABLE_KEYS,
  isSecretKey,
  type RedactedSetting,
  type SettingSource,
  type SettingsKey,
} from "../domain/settings";
import { SettingsError } from "../domain/errors";
import { AppConfigService, type AppConfig } from "./config";
import { decryptSetting, encryptSetting, isEncryptedValue } from "./secrets";
import { SettingsStore } from "./settings-store";

const parsePositiveInt = (raw: string, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export class SettingsService extends Effect.Service<SettingsService>()(
  "SettingsService",
  {
    effect: Effect.gen(function* () {
      const store = yield* SettingsStore;
      const env = yield* AppConfigService;

      /** Raw stored overrides (decrypted for secrets). Unknown/corrupt entries fail closed per key. */
      const readOverrides = (): Effect.Effect<Partial<Record<SettingsKey, string>>, SettingsError> =>
        Effect.gen(function* () {
          const raw = yield* store.getAllRaw();
          const out: Partial<Record<SettingsKey, string>> = {};
          for (const [key, value] of Object.entries(raw)) {
            if (!(EDITABLE_KEYS as readonly string[]).includes(key)) continue;
            const k = key as SettingsKey;
            if (isSecretKey(k)) {
              if (!isEncryptedValue(value)) continue;
              const decrypted = yield* decryptSetting(value).pipe(
                Effect.orElseSucceed(() => null),
              );
              if (decrypted === null || decrypted.length === 0) continue;
              out[k] = decrypted;
            } else {
              out[k] = value;
            }
          }
          return out;
        });

      /** Effective application config: stored override → env → built-in default. */
      const getEffective = (): Effect.Effect<AppConfig, SettingsError> =>
        Effect.gen(function* () {
          const o = yield* readOverrides();
          return {
            ...env,
            llmBaseUrl: o.LLM_BASE_URL ?? env.llmBaseUrl,
            llmApiKey: o.LLM_API_KEY ?? env.llmApiKey,
            llmModel: o.LLM_MODEL ?? env.llmModel,
            githubToken: o.GITHUB_TOKEN ?? env.githubToken,
            workspaceDir: o.WORKSPACE_DIR ?? env.workspaceDir,
            sandboxTimeoutMs: o.SANDBOX_TIMEOUT_MS
              ? parsePositiveInt(o.SANDBOX_TIMEOUT_MS, env.sandboxTimeoutMs)
              : env.sandboxTimeoutMs,
            maxRepairAttempts: o.MAX_REPAIR_ATTEMPTS
              ? parsePositiveInt(o.MAX_REPAIR_ATTEMPTS, env.maxRepairAttempts)
              : env.maxRepairAttempts,
          } satisfies AppConfig;
        });

      const envPresent = (name: string): boolean => {
        const v = process.env[name];
        return v !== undefined && v !== "";
      };

      const sourceOf = (key: SettingsKey, overrides: Partial<Record<SettingsKey, string>>): SettingSource => {
        if (overrides[key] !== undefined) return "db";
        switch (key) {
          case "LLM_BASE_URL":
            return env.llmBaseUrl ? "env" : "default";
          case "LLM_API_KEY":
            return env.llmApiKey ? "env" : "default";
          case "LLM_MODEL":
            return envPresent("LLM_MODEL") ? "env" : "default";
          case "GITHUB_TOKEN":
            return env.githubToken ? "env" : "default";
          case "WORKSPACE_DIR":
            return envPresent("WORKSPACE_DIR") ? "env" : "default";
          case "SANDBOX_TIMEOUT_MS":
            return envPresent("SANDBOX_TIMEOUT_MS") ? "env" : "default";
          case "MAX_REPAIR_ATTEMPTS":
            return "default";
        }
      };

      return {
        getEffective,

        /** Redacted per-key view for the UI. Secret values are never included. */
        describe: (): Effect.Effect<RedactedSetting[], SettingsError> =>
          Effect.gen(function* () {
            const overrides = yield* readOverrides();
            const effective = yield* getEffective();
            const str = (v: string | undefined): string | undefined => v;
            return EDITABLE_KEYS.map((key): RedactedSetting => {
              const source = sourceOf(key, overrides);
              switch (key) {
                case "LLM_BASE_URL":
                  return { key, configured: Boolean(effective.llmBaseUrl), source, value: str(effective.llmBaseUrl) };
                case "LLM_API_KEY":
                  return { key, configured: Boolean(effective.llmApiKey), source };
                case "LLM_MODEL":
                  return { key, configured: true, source, value: effective.llmModel };
                case "GITHUB_TOKEN":
                  return { key, configured: Boolean(effective.githubToken), source };
                case "WORKSPACE_DIR":
                  return { key, configured: true, source, value: effective.workspaceDir };
                case "SANDBOX_TIMEOUT_MS":
                  return { key, configured: true, source, value: effective.sandboxTimeoutMs };
                case "MAX_REPAIR_ATTEMPTS":
                  return { key, configured: true, source, value: effective.maxRepairAttempts };
              }
            });
          }),

        /**
         * Persist validated overrides. Secrets are encrypted; plaintext values
         * are stored raw. Never logs values.
         */
        setMany: (values: Partial<Record<SettingsKey, string | number>>): Effect.Effect<void, SettingsError> =>
          Effect.gen(function* () {
            for (const [key, value] of Object.entries(values)) {
              if (value === undefined) continue;
              const k = key as SettingsKey;
              const text = String(value);
              if (isSecretKey(k)) {
                const encrypted = yield* encryptSetting(text);
                yield* store.setRaw(k, encrypted);
              } else {
                yield* store.setRaw(k, text);
              }
            }
            yield* Effect.logInfo(`settings updated: ${Object.keys(values).join(", ")}`);
          }),

        clear: (key: SettingsKey): Effect.Effect<void, SettingsError> =>
          Effect.zipRight(
            store.delete(key),
            Effect.logInfo(`settings cleared: ${key}`),
          ),

        /**
         * Live LLM check with candidate values (nothing persisted).
         * Uses the models endpoint — cheap and auth-revealing.
         */
        testLLM: (args: { baseUrl: string; apiKey: string }): Effect.Effect<{ modelCount: number }, SettingsError> =>
          Effect.tryPromise({
            try: async () => {
              const base = args.baseUrl.replace(/\/+$/, "");
              const res = await fetch(`${base}/models`, {
                headers: { authorization: `Bearer ${args.apiKey}` },
                signal: AbortSignal.timeout(15_000),
              });
              if (!res.ok) {
                throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
              }
              const json = (await res.json()) as { data?: unknown[] };
              return { modelCount: Array.isArray(json.data) ? json.data.length : 0 };
            },
            catch: (e) =>
              new SettingsError({
                message: `LLM connection failed: ${e instanceof Error ? e.message : String(e)}`,
              }),
          }),

        /** Live GitHub token check (nothing persisted). Returns the login. */
        testGitHub: (token: string): Effect.Effect<{ login: string }, SettingsError> =>
          Effect.tryPromise({
            try: async () => {
              const client = new Octokit({ auth: token });
              const { data } = await client.rest.users.getAuthenticated();
              return { login: data.login };
            },
            catch: () =>
              new SettingsError({ message: "GitHub token rejected — check the token and try again" }),
          }),
      };
    }),
  },
) {}
