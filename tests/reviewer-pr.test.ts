import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { generatePRProposal } from "../src/server/agents/pr-generator";
import { reviewPatch } from "../src/server/agents/reviewer";
import {
  FixPlan,
  Hypothesis,
  IssueAnalysis,
  ReproductionResult,
  ReviewResult,
  TestVerdict,
} from "../src/server/domain/schemas";
import { makeAppConfigLayer } from "../src/server/services/config";
import { LLMService } from "../src/server/services/llm";
import { testEnv } from "./helpers";

const TestEnv = testEnv(makeAppConfigLayer());
const TestLive = Layer.mergeAll(
  TestEnv,
  LLMService.Default.pipe(Layer.provide(TestEnv)),
);

describe("code reviewer", () => {
  test("flags an exfiltrated-looking secret as critical and blocks", async () => {
    const review = await Effect.runPromise(
      reviewPatch({
        diff: `+++ b/src/auth.ts\n+const token = "ghp_abcdefghijklmnopqrstuvwx123456";\n+export const x = 1;`,
        filesChanged: ["src/auth.ts"],
        testSummary: "bun test: PASS",
        fixDescription: "fix auth",
      }).pipe(Effect.provide(TestLive)),
    );
    expect(review.approved).toBe(false);
    expect(review.severity).toBe("critical");
    expect(review.findings.some((f) => f.category === "security")).toBe(true);
  });

  test("approves a minimal clean patch", async () => {
    const review = await Effect.runPromise(
      reviewPatch({
        diff: `+++ b/src/cache.ts\n-    if (this.connected) {\n+    if (!(this.connected)) {`,
        filesChanged: ["src/cache.ts"],
        testSummary: "bun test: PASS",
        fixDescription: "fix inverted guard",
      }).pipe(Effect.provide(TestLive)),
    );
    expect(review.approved).toBe(true);
    expect(review.severity).toBe("low");
  });

  test("flags removed tests without a regression test", async () => {
    const review = await Effect.runPromise(
      reviewPatch({
        diff: `+++ b/src/a.ts\n-    deleteUserCache();\n--- a/tests/a.test.ts\n-    expect(x).toBe(1);`,
        filesChanged: ["src/a.ts", "tests/a.test.ts"],
        testSummary: "bun test: PASS",
        fixDescription: "cleanup",
      }).pipe(Effect.provide(TestLive)),
    );
    expect(review.findings.some((f) => f.category === "tests")).toBe(true);
  });
});

describe("PR generator", () => {
  test("produces a complete, linked proposal", async () => {
    const proposal = await Effect.runPromise(
      generatePRProposal({
        analysis: new IssueAnalysis({
          summary: "Requests fail after cache reconnects",
          kind: "bug",
          severity: "high",
          keywords: ["cache", "reconnect"],
          suspectedAreas: ["src/cache.ts"],
          reproductionHints: [],
          questions: [],
        }),
        rootCause: new Hypothesis({
          id: "h1",
          title: "inverted guard",
          description: "connected check inverted",
          evidence: [],
          confidence: 0.8,
          status: "confirmed",
        }),
        plan: new FixPlan({
          problem: "p",
          rootCause: "r",
          files: ["src/cache.ts"],
          changes: ["flip guard"],
          regressionTest: "bun test",
          risk: "low",
          expectedBehavior: "works",
        }),
        reproduction: new ReproductionResult({ reproduced: true, method: "bun test", detail: "fails" }),
        verdicts: [
          new TestVerdict({ passed: true, command: "bun test", exitCode: 0, summary: "ok", output: "" }),
        ],
        review: new ReviewResult({ approved: true, severity: "low", findings: [], summary: "good" }),
        diff: "+++ b/src/cache.ts\n+line\n-line",
        issueNumber: 7,
      }),
    );
    expect(proposal.branch).toContain("issue-7");
    expect(proposal.body).toContain("Fixes #7");
    expect(proposal.title.startsWith("fix:")).toBe(true);
    expect(proposal.additions).toBe(1);
    expect(proposal.deletions).toBe(1);
  });
});
