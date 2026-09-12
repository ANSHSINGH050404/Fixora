import { describe, expect, test } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import { scoreRelevance } from "../src/server/services/mapper";
import { TaskStore } from "../src/server/services/store-memory";
import { TaskStoreMemoryLive } from "../src/server/services/store-memory";
import { StoreError } from "../src/server/domain/errors";

describe("mapper scoring", () => {
  test("ranks keyword-matching source files first", () => {
    const kws = ["retry", "webhook", "redis"];
    const files = ["docs/README.md", "src/queue/webhook-worker.ts", "src/redis/client.ts", "package.json"];
    const ranked = files
      .map((f) => ({ f, s: scoreRelevance(f, kws) }))
      .sort((a, b) => b.s - a.s)
      .map((r) => r.f);
    expect(ranked[0]).toBe("src/queue/webhook-worker.ts");
    expect(ranked).toContain("src/redis/client.ts");
  });

  test("penalizes build output", () => {
    expect(scoreRelevance("dist/worker.js", ["worker"])).toBeLessThan(0);
    expect(scoreRelevance("node_modules/x/index.js", ["x"])).toBeLessThan(0);
  });
});

describe("memory task store", () => {
  // One shared runtime: each Layer.build would create isolated state.
  const TestRuntime = ManagedRuntime.make(TaskStoreMemoryLive);
  const use =
    <A, E>(fn: (s: import("../src/server/services/store-memory").TaskStoreApi) => Effect.Effect<A, E>) =>
      Effect.flatMap(TaskStore, fn);
  const run = <A, E>(eff: Effect.Effect<A, E, TaskStore>) => TestRuntime.runPromise(eff);

  test("full lifecycle roundtrip with validated transitions", async () => {
    const task = await run(
      use((s) =>
        s.createTask({
          repositoryUrl: "https://github.com/example/project",
          owner: "example",
          name: "project",
          defaultBranch: "main",
          issueNumber: 123,
          issueTitle: "Webhook retry fails when Redis is down",
          issueBody: "retries lost after reconnect",
          issueState: "open",
          issueLabels: ["bug"],
          hasUserToken: false,
        })
      ),
    );
    expect(task.status).toBe("QUEUED");

    await run(use((s) => s.setStatus(task.id, "ANALYZING_ISSUE", "test")));
    const updated = await run(use((s) => s.getTask(task.id)));
    expect(updated.status).toBe("ANALYZING_ISSUE");

    const transitions = await run(use((s) => s.listTransitions(task.id)));
    expect(transitions.map((t) => t.to)).toEqual(["QUEUED", "ANALYZING_ISSUE"]);

    const step = await run(use((s) => s.beginStep(task.id, "ISSUE_ANALYSIS", { a: 1 })));
    await run(use((s) => s.endStep(step.id, { status: "success", summary: "done" })));
    const steps = await run(use((s) => s.listSteps(task.id)));
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("success");
    expect(steps[0].durationMs).not.toBeNull();

    const hyps = await run(
      use((s) => s.saveHypotheses(task.id, [{ title: "h1", description: "d1", confidence: 0.7 }])),
    );
    expect(hyps).toHaveLength(1);
    await run(use((s) => s.setHypothesisStatus(hyps[0].id, "confirmed", "yes")));
    const listed = await run(use((s) => s.listHypotheses(task.id)));
    expect(listed[0].status).toBe("confirmed");

    const err = await TestRuntime.runPromise(
      use((s) => s.setStatus(task.id, "IMPLEMENTING", "illegal skip")).pipe(Effect.flip),
    );
    expect(err).toBeInstanceOf(StoreError);
  });
});
