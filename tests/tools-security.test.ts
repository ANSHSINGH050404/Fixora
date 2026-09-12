import { describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { defineTool, ToolRegistry } from "../src/server/agents/tools";
import { SecurityError, ToolError } from "../src/server/domain/errors";
import { makeAppConfigLayer } from "../src/server/services/config";
import { RepositoryService, resolveInside } from "../src/server/services/repository";
import { testEnv } from "./helpers";

describe("tool registry", () => {
  const registry = new ToolRegistry();
  registry.register(
    defineTool({
      name: "echo_plus_one",
      description: "test tool",
      inputSchema: Schema.Struct({ n: Schema.Number }),
      parameters: { type: "object" },
      execute: ({ n }) => Effect.succeed(n + 1),
    }),
  );

  test("calls a registered tool with validated input", async () => {
    const out = await Effect.runPromise(registry.call("echo_plus_one", { n: 41 }));
    expect(out).toBe(42);
  });

  test("rejects unknown tools", async () => {
    const err = await Effect.runPromise(Effect.flip(registry.call("nope", {})));
    expect(err).toBeInstanceOf(ToolError);
  });

  test("rejects schema-invalid input", async () => {
    const err = await Effect.runPromise(Effect.flip(registry.call("echo_plus_one", { n: "x" })));
    expect(err).toBeInstanceOf(ToolError);
  });
});

describe("security boundaries", () => {
  const TestEnv = testEnv(makeAppConfigLayer());
  const RepoLive = RepositoryService.Default.pipe(Layer.provide(TestEnv));
  const run = <A, E>(eff: Effect.Effect<A, E, RepositoryService>) =>
    Effect.runPromise(eff.pipe(Effect.provide(RepoLive)));

  test("path traversal escapes are rejected", async () => {
    const err = await Effect.runPromise(
      Effect.flip(resolveInside("C:\\work\\repo", "..\\..\\windows\\system32\\evil")),
    );
    expect(err).toBeInstanceOf(SecurityError);
  });

  test("absolute escape attempts are rejected", async () => {
    const err = await Effect.runPromise(
      Effect.flip(resolveInside("C:\\work\\repo", "C:\\windows\\system32\\evil")),
    );
    expect(err).toBeInstanceOf(SecurityError);
  });

  test("legit relative paths resolve inside the root", async () => {
    const abs = await Effect.runPromise(resolveInside("C:\\work\\repo", "src/cache.ts"));
    expect(abs.endsWith("cache.ts")).toBe(true);
  });

  test("search patterns with control characters are rejected", async () => {
    const err = await run(
      Effect.flip(
        Effect.flatMap(RepositoryService, (r) => r.search("C:\\work\\repo", ["a\nb"])),
      ),
    );
    expect(err).toBeInstanceOf(SecurityError);
  });
});
