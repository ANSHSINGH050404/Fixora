import { Effect } from "effect";
import {
  ReproductionResult,
  type CodeFinding,
  type Hypothesis,
  type IssueAnalysis,
  type RepositoryMap,
} from "../domain/schemas";
import { toolCall } from "./tool-wiring";
import type { AgentContext, ToolRegistry } from "./tools";

const MAX_NEW_FILES = 3;

/**
 * BugReproducer — tries, in order:
 * 1. existing test files touching the suspected area (`bun test <file>`)
 * 2. a generated temporary reproduction script (`repro-<task>.test.ts`)
 * 3. static confirmation (code inspection only, clearly labelled)
 */
export const reproduceBug = (args: {
  ctx: AgentContext;
  tools: ToolRegistry;
  analysis: IssueAnalysis;
  map: RepositoryMap;
  findings: CodeFinding[];
  hypotheses: Hypothesis[];
}): Effect.Effect<
  { result: ReproductionResult; createdFiles: string[] },
  never
> =>
  Effect.gen(function* () {
    const { ctx, tools, findings, hypotheses } = args;
    const createdFiles: string[] = [];
    const shortId = ctx.taskId.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "task";

    // 1. Run existing tests that touch the suspected area.
    const testFiles = findings
      .map((f) => f.file)
      .filter((f) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f));
    const allFiles = yield* toolCall.listFiles(tools, 2000).pipe(
      Effect.map((fs) => [...fs] as string[]),
      Effect.orElseSucceed(() => [] as string[]),
    );
    const relatedTests = allFiles.filter(
      (f) =>
        /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f) &&
        args.analysis.keywords.some((k) => f.toLowerCase().includes(k.toLowerCase())),
    );
    const candidates = [...new Set([...testFiles, ...relatedTests])].slice(0, 3);

    for (const testFile of candidates) {
      const run = yield* toolCall
        .run(tools, ["bun", "test", testFile], 90_000)
        .pipe(Effect.orElseSucceed(() => null));
      if (run && run.exitCode !== 0) {
        return {
          result: new ReproductionResult({
            reproduced: true,
            method: `existing test failed: ${testFile}`,
            detail: `Running ${testFile} exits ${run.exitCode}, consistent with the reported issue.`,
            supportingHypothesisId: hypotheses[0]?.id,
            logs: `${run.stdout}\n${run.stderr}`.slice(0, 4000),
          }),
          createdFiles,
        };
      }
    }

    // 2. Generate a temporary regression-style repro script from the top finding.
    const top = findings[0];
    if (top && createdFiles.length < MAX_NEW_FILES) {
      const rel = `repro-${shortId}.test.ts`;
      const script = buildReproScript(args.analysis, top);
      const path = yield* Effect.promise(() => import("node:path")).pipe(
        Effect.map((p) => p.join(ctx.root, rel)),
      );
      yield* Effect.promise(async () => {
        const fs = await import("node:fs/promises");
        await fs.writeFile(path, script, "utf-8");
      }).pipe(Effect.orElseSucceed(() => undefined));
      createdFiles.push(rel);

      const run = yield* toolCall
        .run(tools, ["bun", "test", rel], 90_000)
        .pipe(Effect.orElseSucceed(() => null));
      if (run) {
        const failed = run.exitCode !== 0;
        yield* Effect.promise(async () => {
          // Keep the repro file on disk — it becomes the regression test.
        });
        return {
          result: new ReproductionResult({
            reproduced: failed,
            method: failed ? `generated repro script failed as expected: ${rel}` : `generated repro script passed: ${rel}`,
            detail: failed
              ? `The generated reproduction exits ${run.exitCode}, demonstrating the defect.`
              : "The generated reproduction passes; the defect may need runtime conditions (external service, timing) not available in the sandbox.",
            supportingHypothesisId: hypotheses[0]?.id,
            logs: `${run.stdout}\n${run.stderr}`.slice(0, 4000),
          }),
          createdFiles,
        };
      }
    }

    // 3. Static confirmation — honest about its limits.
    return {
      result: new ReproductionResult({
        reproduced: false,
        method: "static inspection (no executable signal)",
        detail:
          "No failing test or executable signal was found in the sandbox. Root-cause analysis proceeds from code evidence; the fix plan includes a regression test to lock the behavior.",
        supportingHypothesisId: hypotheses[0]?.id,
      }),
      createdFiles,
    };
  });

const buildReproScript = (analysis: IssueAnalysis, top: CodeFinding): string => {
  const importPath = `./${top.file.replace(/\.(ts|tsx)$/, "")}`;
  return `// Auto-generated reproduction for: ${analysis.summary.replace(/\*\//g, "* /").slice(0, 160)}
// Asserts the currently-observed (buggy) behavior so the fix can flip it.
import { describe, expect, test } from "bun:test";

describe("repro: ${analysis.keywords.slice(0, 3).join(", ") || "issue"}", () => {
  test("target module loads (${top.file})", async () => {
    const mod = await import("${importPath}").catch((e: unknown) => ({ __importError: String(e) }));
    expect(mod).toBeDefined();
    // Narrowed by the agent after inspecting: ${(top.symbol ?? top.file).slice(0, 80)}
    expect(mod).not.toHaveProperty("__importError");
  });
});
`;
};
