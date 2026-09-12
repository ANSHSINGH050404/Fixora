import { Effect, Schema } from "effect";
import { GitHubService } from "../services/github";
import { RepositoryService } from "../services/repository";
import { SandboxService } from "../services/sandbox";
import { ToolError } from "../domain/errors";
import { ToolRegistry, defineTool, type AgentContext } from "./tools";

/** Decode untrusted tool output through a schema at the boundary. */
const callTyped = <A>(registry: ToolRegistry, name: string, input: unknown, output: Schema.Schema<A>) =>
  Effect.flatMap(
    registry.call(name, input).pipe(
      Effect.mapError((e) => e as ToolError),
    ),
    (raw) =>
      Schema.decodeUnknown(output)(raw).pipe(
        Effect.mapError((e) => new ToolError({ message: `bad output from ${name}: ${String(e)}`, tool: name })),
      ),
  );

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const SearchHit = Schema.Struct({ file: Schema.String, line: Schema.Number, text: Schema.String });
const CommitInfo = Schema.Struct({ sha: Schema.String, message: Schema.String, author: Schema.String, date: Schema.String });

/**
 * Build the agent-facing tool registry. Agents request capabilities through
 * these named, schema-validated tools instead of touching infrastructure.
 */
export const buildRegistry = (
  ctx: AgentContext,
): Effect.Effect<ToolRegistry, never, RepositoryService | SandboxService | GitHubService> =>
  Effect.gen(function* () {
    const repo = yield* RepositoryService;
    const sandbox = yield* SandboxService;
    const github = yield* GitHubService;
    const registry = new ToolRegistry();

    registry.register(
      defineTool({
        name: "repo_list_files",
        description: "List git-tracked files in the local checkout (capped).",
        inputSchema: Schema.Struct({ limit: Schema.optional(Schema.Number) }),
        parameters: { type: "object", properties: { limit: { type: "number" } } },
        execute: ({ limit }) => repo.listFiles(ctx.root, limit ?? 2000).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "repo_list_files" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "repo_read_file",
        description: "Read a repo-relative file from the local checkout.",
        inputSchema: Schema.Struct({ path: NonEmptyString }),
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        execute: ({ path }) =>
          Effect.map(
            repo.readFile(ctx.root, path),
            (f) => ({ path: f.path, content: f.content }),
          ).pipe(Effect.mapError((e) => new ToolError({ message: e.message, tool: "repo_read_file" }))),
      }),
    );

    registry.register(
      defineTool({
        name: "repo_search",
        description: "Fixed-string code search over the local checkout (OR across keywords).",
        inputSchema: Schema.Struct({ keywords: Schema.Array(Schema.String).pipe(Schema.minItems(1)) }),
        parameters: { type: "object", properties: { keywords: { type: "array", items: { type: "string" } } }, required: ["keywords"] },
        execute: ({ keywords }) => repo.search(ctx.root, [...keywords], 30).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "repo_search" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "repo_git_history",
        description: "Recent commits touching a file (or the whole checkout).",
        inputSchema: Schema.Struct({ file: Schema.optional(Schema.String), limit: Schema.optional(Schema.Number) }),
        parameters: { type: "object", properties: { file: { type: "string" }, limit: { type: "number" } } },
        execute: ({ file, limit }) => repo.recentCommits(ctx.root, file, limit ?? 10).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "repo_git_history" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "sandbox_run",
        description: "Run an allowlisted command (bun, bunx, git) in the sandbox. Returns exit code + output; non-zero is data, not failure.",
        inputSchema: Schema.Struct({ command: Schema.Array(Schema.String).pipe(Schema.minItems(1)), timeoutMs: Schema.optional(Schema.Number) }),
        parameters: { type: "object", properties: { command: { type: "array", items: { type: "string" } }, timeoutMs: { type: "number" } }, required: ["command"] },
        execute: ({ command, timeoutMs }) => sandbox.run({ cwd: ctx.root, command: [...command], timeoutMs }).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "sandbox_run" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "sandbox_test",
        description: "Run the repository test command in the sandbox.",
        inputSchema: Schema.Struct({ args: Schema.optional(Schema.Array(Schema.String)) }),
        parameters: { type: "object", properties: { args: { type: "array", items: { type: "string" } } } },
        execute: ({ args }) => sandbox.run({ cwd: ctx.root, command: ["bun", "test", ...(args ?? [])], timeoutMs: 120_000 }).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "sandbox_test" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "patch_diff",
        description: "Current uncommitted diff of the working tree (the patch in progress).",
        inputSchema: Schema.Struct({}),
        parameters: { type: "object", properties: {} },
        execute: () => repo.currentDiff(ctx.root).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "patch_diff" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "github_get_file",
        description: "Fetch a file from GitHub at a ref (pre-change ground truth).",
        inputSchema: Schema.Struct({ path: NonEmptyString, ref: Schema.optional(Schema.String) }),
        parameters: { type: "object", properties: { path: { type: "string" }, ref: { type: "string" } }, required: ["path"] },
        execute: ({ path, ref }) => github.getFile(ctx.owner, ctx.name, path, ref ?? ctx.branch, ctx.token).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "github_get_file" })),
        ),
      }),
    );

    registry.register(
      defineTool({
        name: "github_search_code",
        description: "GitHub code search scoped to this repository.",
        inputSchema: Schema.Struct({ query: NonEmptyString }),
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
        execute: ({ query }) => github.searchCode(ctx.owner, ctx.name, query, ctx.token).pipe(
          Effect.mapError((e) => new ToolError({ message: e.message, tool: "github_search_code" })),
        ),
      }),
    );

    return registry;
  });

export const toolCall = {
  listFiles: (r: ToolRegistry, limit?: number) =>
    callTyped(r, "repo_list_files", { limit }, Schema.Array(Schema.String)),
  readFile: (r: ToolRegistry, path: string) =>
    callTyped(r, "repo_read_file", { path }, Schema.Struct({ path: Schema.String, content: Schema.String })),
  search: (r: ToolRegistry, keywords: string[]) =>
    callTyped(r, "repo_search", { keywords }, Schema.Array(SearchHit)),
  history: (r: ToolRegistry, file?: string, limit?: number) =>
    callTyped(r, "repo_git_history", { file, limit }, Schema.Array(CommitInfo)),
  run: (r: ToolRegistry, command: string[], timeoutMs?: number) =>
    callTyped(
      r,
      "sandbox_run",
      { command, timeoutMs },
      Schema.Struct({
        command: Schema.String,
        exitCode: Schema.Number,
        stdout: Schema.String,
        stderr: Schema.String,
        durationMs: Schema.Number,
        timedOut: Schema.Boolean,
        backend: Schema.Literal("docker", "local"),
      }),
    ),
  diff: (r: ToolRegistry) => callTyped(r, "patch_diff", {}, Schema.String),
};
