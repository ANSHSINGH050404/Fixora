import { Effect } from "effect";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly taskId?: string;
  readonly step?: string;
  readonly durationMs?: number;
  readonly status?: string;
  readonly [key: string]: unknown;
}

/** Minimal structured JSON logger on top of Effect.log. */
export const logStructured = (
  level: LogLevel,
  message: string,
  fields: LogFields = {},
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const payload = JSON.stringify({ message, ...fields });
    switch (level) {
      case "debug":
        yield* Effect.logDebug(payload);
        break;
      case "info":
        yield* Effect.logInfo(payload);
        break;
      case "warn":
        yield* Effect.logWarning(payload);
        break;
      case "error":
        yield* Effect.logError(payload);
        break;
    }
  });

export const logStep = (
  taskId: string,
  step: string,
  status: string,
  extra: LogFields = {},
): Effect.Effect<void> =>
  logStructured("info", `step:${step}`, { taskId, step, status, ...extra });
