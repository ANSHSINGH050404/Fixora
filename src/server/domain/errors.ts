import { Data } from "effect";

/** GitHub API failures. Never leak tokens in messages. */
export class GitHubError extends Data.TaggedError("GitHubError")<{
  readonly message: string;
  readonly status?: number;
  readonly endpoint?: string;
}> {}

/** Repository cloning / filesystem inspection failures. */
export class RepositoryAnalysisError extends Data.TaggedError(
  "RepositoryAnalysisError",
)<{
  readonly message: string;
  readonly path?: string;
}> {}

/** Sandboxed command execution failures. */
export class SandboxExecutionError extends Data.TaggedError(
  "SandboxExecutionError",
)<{
  readonly command: string;
  readonly exitCode?: number;
  readonly stderr?: string;
  readonly timedOut?: boolean;
}> {}

/** LLM provider failures (transport, auth, malformed output). */
export class LLMError extends Data.TaggedError("LLMError")<{
  readonly message: string;
  readonly provider?: string;
  readonly retryable?: boolean;
}> {}

/** Tool registry failures (unknown tool, schema validation). */
export class ToolError extends Data.TaggedError("ToolError")<{
  readonly message: string;
  readonly tool?: string;
}> {}

/** Agent stage failure with structured context for repair loops. */
export class AgentStageError extends Data.TaggedError("AgentStageError")<{
  readonly stage: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Task store (database) failures. */
export class StoreError extends Data.TaggedError("StoreError")<{
  readonly message: string;
  readonly operation?: string;
}> {}

/** Raised when a state transition is not allowed. */
export class InvalidTransitionError extends Data.TaggedError(
  "InvalidTransitionError",
)<{
  readonly from: string;
  readonly to: string;
}> {}

/** Security boundary violations (path traversal, blocked command, secret). */
export class SecurityError extends Data.TaggedError("SecurityError")<{
  readonly message: string;
  readonly detail?: string;
}> {}

/** Settings storage / crypto / validation failures. Values never included. */
export class SettingsError extends Data.TaggedError("SettingsError")<{
  readonly message: string;
  readonly key?: string;
}> {}
