import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { analyzeIssue, extractKeywords } from "../src/server/agents/issue-analyzer";
import { makeAppConfigLayer } from "../src/server/services/config";
import { LLMService } from "../src/server/services/llm";
import { testEnv } from "./helpers";

const TestEnv = testEnv(makeAppConfigLayer());
/** Real LLMService with no backend configured → deterministic-only mode. */
const LLMLayer = LLMService.Default.pipe(Layer.provide(TestEnv));
const TestLive = Layer.mergeAll(TestEnv, LLMLayer);

describe("issue analyzer", () => {
  test("extracts meaningful keywords, drops stopwords", () => {
    const kws = extractKeywords(
      "Webhook retry fails when Redis is down",
      "After a redis reconnect the webhook worker loses retries. The retry queue seems stale.",
    );
    expect(kws).toContain("redis");
    expect(kws).toContain("retry");
    expect(kws).toContain("webhook");
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("when");
  });

  test("classifies a crash report as a high-severity bug", async () => {
    const analysis = await Effect.runPromise(
      analyzeIssue({
        title: "Webhook retry fails when Redis is down",
        body: "worker crashes with 500 after reconnect",
        labels: [],
        comments: [],
      }).pipe(Effect.provide(TestLive)),
    );
    expect(analysis.kind).toBe("bug");
    expect(["high", "critical"]).toContain(analysis.severity);
    expect(analysis.keywords.length).toBeGreaterThan(0);
  });

  test("degrades gracefully without an LLM backend", async () => {
    const analysis = await Effect.runPromise(
      analyzeIssue({ title: "Add dark mode", body: "please add theme toggle", labels: ["feature"], comments: [] }).pipe(
        Effect.provide(TestLive),
      ),
    );
    expect(analysis.kind).toBe("feature");
    expect(analysis.summary).toContain("dark mode");
  });
});
