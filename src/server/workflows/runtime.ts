import { Effect, Layer, ManagedRuntime } from "effect";
import { AppConfigLive } from "../services/config";
import { GitHubService } from "../services/github";
import { LLMService } from "../services/llm";
import { RepositoryService } from "../services/repository";
import { SandboxService } from "../services/sandbox";
import { SettingsService } from "../services/settings";
import { SettingsStoreLive } from "../services/settings-store";
import { TaskStoreLive } from "../services/store-postgres";
import type { WorkflowServices } from "./run-task";

type WorkflowDeps = WorkflowServices;

/** Config failures are deployment defects — crash loudly, not silently. */
const ConfigOrDie = Layer.orDie(AppConfigLive);

/** Settings stack: env config + settings store, feeding the hot SettingsService. */
const SettingsLive = SettingsService.Default.pipe(
  Layer.provide(
    Layer.mergeAll(ConfigOrDie, SettingsStoreLive.pipe(Layer.provide(ConfigOrDie))),
  ),
);

/** Dependencies for agent-facing services (env config + hot settings). */
const ServiceDepsLive = Layer.mergeAll(ConfigOrDie, SettingsLive);

/** Full production layer stack for workflows and API routes. */
export const AppLive: Layer.Layer<WorkflowDeps> = Layer.mergeAll(
  ConfigOrDie,
  SettingsLive,
  TaskStoreLive.pipe(Layer.provide(ConfigOrDie)),
  GitHubService.Default.pipe(Layer.provide(ServiceDepsLive)),
  RepositoryService.Default.pipe(Layer.provide(ServiceDepsLive)),
  SandboxService.Default.pipe(Layer.provide(ServiceDepsLive)),
  LLMService.Default.pipe(Layer.provide(ServiceDepsLive)),
);

const runtime = ManagedRuntime.make(AppLive);

/** Run an Effect workflow on the shared runtime (fire-and-forget safe). */
export const runFork = <A, E>(effect: Effect.Effect<A, E, WorkflowDeps>): void => {
  runtime.runFork(effect.pipe(Effect.catchAll((e) => Effect.logError(`background workflow failed: ${String(e)}`))));
};

/** Run and await (API routes that need the result). */
export const runPromise = <A, E>(effect: Effect.Effect<A, E, WorkflowDeps>): Promise<A> =>
  runtime.runPromise(effect as Effect.Effect<A, E>);
