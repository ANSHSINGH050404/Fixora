import { Schema } from "effect";

/** Keys editable at runtime from the Settings UI. */
export const EDITABLE_KEYS = [
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "GITHUB_TOKEN",
  "WORKSPACE_DIR",
  "SANDBOX_TIMEOUT_MS",
  "MAX_REPAIR_ATTEMPTS",
] as const;

export type SettingsKey = (typeof EDITABLE_KEYS)[number];

export const isSettingsKey = (key: string): key is SettingsKey =>
  (EDITABLE_KEYS as readonly string[]).includes(key);

/** Keys whose values are secrets: encrypted at rest, never returned by APIs. */
export const SECRET_KEYS: ReadonlySet<string> = new Set(["LLM_API_KEY", "GITHUB_TOKEN"]);

export const isSecretKey = (key: SettingsKey): boolean => SECRET_KEYS.has(key);

const HttpUrl = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(500),
  Schema.pattern(
    /^https?:\/\/[^\s/$.?#].[^\s]*$/i,
    { message: () => "must be an http(s) URL" },
  ),
);

const SecretValue = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(2000));

/**
 * Validated PUT body. Every field is optional; provided fields must be valid.
 * Empty/absent secret fields are omitted client-side ("keep existing");
 * clearing is done via DELETE.
 */
export class SettingsPutBody extends Schema.Class<SettingsPutBody>("SettingsPutBody")({
  LLM_BASE_URL: Schema.optional(HttpUrl),
  LLM_API_KEY: Schema.optional(SecretValue),
  LLM_MODEL: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200))),
  GITHUB_TOKEN: Schema.optional(SecretValue),
  WORKSPACE_DIR: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000))),
  SANDBOX_TIMEOUT_MS: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(5_000), Schema.lessThanOrEqualTo(600_000)),
  ),
  MAX_REPAIR_ATTEMPTS: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1), Schema.lessThanOrEqualTo(10)),
  ),
}) {}

/** Where an effective value comes from (for UI badges). */
export type SettingSource = "db" | "env" | "default";

/** Redacted per-key view for the UI. Secret values are never included. */
export interface RedactedSetting {
  readonly key: SettingsKey;
  readonly configured: boolean;
  readonly source: SettingSource;
  /** Effective value — present only for non-secret keys. */
  readonly value?: string | number;
}

export const SETTING_LABELS: Record<SettingsKey, string> = {
  LLM_BASE_URL: "LLM base URL",
  LLM_API_KEY: "LLM API key",
  LLM_MODEL: "LLM model",
  GITHUB_TOKEN: "GitHub token",
  WORKSPACE_DIR: "Workspace directory",
  SANDBOX_TIMEOUT_MS: "Sandbox timeout (ms)",
  MAX_REPAIR_ATTEMPTS: "Max repair attempts",
};
