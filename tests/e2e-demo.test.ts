import { afterAll, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { runTask } from "../src/server/workflows/run-task";
import { makeAppConfigLayer } from "../src/server/services/config";
import { GitHubService } from "../src/server/services/github";
import { LLMService } from "../src/server/services/llm";
import { RepositoryService } from "../src/server/services/repository";
import { SandboxService } from "../src/server/services/sandbox";
import { TaskStore, TaskStoreMemoryLive } from "../src/server/services/store-memory";
import { testEnv } from "./helpers";

const fixtureDir = `${import.meta.dir}/../demo-fixture/cache-bug`;

const TestConfig = makeAppConfigLayer({
  workspaceDir: `C:\\Users\\ANSHSI~1\\AppData\\Local\\Temp\\opencode\\fixora-e2e`,
});
const TestEnv = testEnv(TestConfig);
const TestLive = Layer.mergeAll(
  TaskStoreMemoryLive,
  TestEnv,
  GitHubService.Default.pipe(Layer.provide(TestEnv)),
  RepositoryService.Default.pipe(Layer.provide(TestEnv)),
  SandboxService.Default.pipe(Layer.provide(TestEnv)),
  LLMService.Default.pipe(Layer.provide(TestEnv)),
);

afterAll(async () => {
  const fs = await import("node:fs/promises");
  await fs.rm(`C:\\Users\\ANSHSI~1\\AppData\\Local\\Temp\\opencode\\fixora-e2e`, { recursive: true, force: true });
});

describe("end-to-end demo: cache reconnect bug", () => {
  test("agent goes from issue to reviewed PR proposal", async () => {
    const program = Effect.gen(function* () {
      const store = yield* TaskStore;
      const task = yield* store.createTask({
        repositoryUrl: "local-demo/cache-bug",
        owner: "local-demo",
        name: "cache-bug",
        defaultBranch: "main",
        issueNumber: 1,
        issueTitle: "Requests occasionally fail after the cache reconnects",
        issueBody:
          "After a cache drop + reconnect, requests that used to hit the cache now fail. " +
          "The retry helper and request layer in src/request.ts are involved. Cache get throws 'cache unavailable'.",
        issueState: "open",
        issueLabels: ["bug"],
        hasUserToken: false,
      });

      yield* runTask(task.id, { localPath: fixtureDir });

      const final = yield* store.getTask(task.id);
      const steps = yield* store.listSteps(task.id);
      const hyps = yield* store.listHypotheses(task.id);
      const patch = yield* store.getLatestPatch(task.id);
      const runs = yield* store.listTestRuns(task.id);
      const review = yield* store.getLatestReview(task.id);
      const pr = yield* store.getPR(task.id);
      return { final, steps, hyps, patch, runs, review, pr };
    });

    const { final, steps, hyps, patch, runs, review, pr } = await Effect.runPromise(
      program.pipe(Effect.provide(TestLive)),
    );

    expect(final.status).toBe("READY_FOR_PR");
    expect(final.error).toBeNull();
    // All 11 pipeline stages recorded at least once.
    const stepTypes = new Set(steps.map((s) => s.type));
    for (const expected of [
      "ISSUE_ANALYSIS", "REPOSITORY_MAPPING", "CODE_EXPLORATION",
      "HYPOTHESIS_GENERATION", "BUG_REPRODUCTION", "ROOT_CAUSE_ANALYSIS",
      "FIX_PLANNING", "IMPLEMENTATION", "TEST_EXECUTION", "CODE_REVIEW", "PR_PROPOSAL",
    ]) {
      expect(stepTypes.has(expected)).toBe(true);
    }
    expect(steps.every((s) => s.status === "success")).toBe(true);
    expect(hyps.length).toBeGreaterThanOrEqual(2);
    expect(hyps.some((h) => h.status === "confirmed")).toBe(true);

    // The patch fixes the inverted guard.
    expect(patch).not.toBeNull();
    expect(patch?.diff).toContain("!(this.connected)");
    expect(patch?.filesChanged).toContain("src/cache.ts");

    // Tests were executed and pass.
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.some((r) => r.passed === 1)).toBe(true);

    // Independent review approved, PR proposal is complete.
    expect(review?.approved).toBe(1);
    expect(pr?.branch).toContain("issue-1");
    expect(pr?.title.startsWith("fix:")).toBe(true);
  }, 300_000);
});
