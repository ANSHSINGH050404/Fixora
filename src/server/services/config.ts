import { Config, Context, Effect, Layer } from "effect";

/** Application configuration, sourced entirely from environment variables. */
export interface AppConfig {
  readonly databaseUrl: string | undefined;
  readonly githubToken: string | undefined;
  readonly llmBaseUrl: string | undefined;
  readonly llmApiKey: string | undefined;
  readonly llmModel: string;
  readonly workspaceDir: string;
  readonly sandboxImage: string;
  readonly sandboxTimeoutMs: number;
  readonly maxRepairAttempts: number;
}

export class AppConfigService extends Context.Tag("AppConfigService")<
  AppConfigService,
  AppConfig
>() {}

const makeConfig = Effect.gen(function* () {
  const databaseUrl = yield* Config.option(Config.string("DATABASE_URL"));
  const githubToken = yield* Config.option(Config.string("GITHUB_TOKEN"));
  const llmBaseUrl = yield* Config.option(Config.string("LLM_BASE_URL"));
  const llmApiKey = yield* Config.option(Config.string("LLM_API_KEY"));
  const llmModel = yield* Config.string("LLM_MODEL").pipe(
    Config.withDefault("qwen3:8b"),
  );
  const workspaceDir = yield* Config.string("WORKSPACE_DIR").pipe(
    Config.withDefault("C:\\Users\\ANSHSI~1\\AppData\\Local\\Temp\\opencode\\fixora-work"),
  );
  const sandboxTimeoutMs = yield* Config.integer(
    "SANDBOX_TIMEOUT_MS",
  ).pipe(Config.withDefault(120_000));

  // Empty env vars (e.g. `KEY=` in .env) count as absent, not as values.
  const present = (o: import("effect").Option.Option<string>): string | undefined =>
    o._tag === "Some" && o.value !== "" ? o.value : undefined;
  const orDefault = (raw: string, fallback: string): string =>
    raw !== "" ? raw : fallback;

  const config: AppConfig = {
    databaseUrl: present(databaseUrl),
    githubToken: present(githubToken),
    llmBaseUrl: present(llmBaseUrl),
    llmApiKey: present(llmApiKey),
    llmModel: orDefault(llmModel, "qwen3:8b"),
    workspaceDir: orDefault(
      workspaceDir,
      "C:\\Users\\ANSHSI~1\\AppData\\Local\\Temp\\opencode\\fixora-work",
    ),
    sandboxImage: "fixora-sandbox:latest",
    sandboxTimeoutMs,
    maxRepairAttempts: 3,
  };
  return config;
});

/** Live config layer, sourced from environment variables. */
export const AppConfigLive: Layer.Layer<AppConfigService, unknown> = Layer.effect(
  AppConfigService,
  makeConfig,
);

/** Build a config layer from explicit values (tests / scripts). */
export const makeAppConfigLayer = (overrides: Partial<AppConfig> = {}) =>
  Layer.succeed(AppConfigService, {
    databaseUrl: undefined,
    githubToken: undefined,
    llmBaseUrl: undefined,
    llmApiKey: undefined,
    llmModel: "test-model",
    workspaceDir:
      "C:\\Users\\ANSHSI~1\\AppData\\Local\\Temp\\opencode\\fixora-test",
    sandboxImage: "fixora-sandbox:latest",
    sandboxTimeoutMs: 30_000,
    maxRepairAttempts: 3,
    ...overrides,
  });
