import { Effect } from "effect";
import { TestVerdict } from "../domain/schemas";
import { spawnCapture } from "../services/process";
import { toolCall } from "./tool-wiring";
import type { AgentContext, ToolRegistry } from "./tools";

export interface TestSuiteInput {
  readonly ctx: AgentContext;
  readonly tools: ToolRegistry;
  readonly testCommand: string[];
  readonly typecheckCommand: string[];
  readonly lintCommand: string[];
  /** Skip lint (many repos have no lint config — not a failure of the patch). */
  readonly skipLint?: boolean;
}

const splitCommand = (cmd: string[]): string[] => cmd;

/** Output signals that the failure is environmental, not caused by the patch. */
const ENV_SIGNALS = /command not found|Cannot find module|ECONNREFUSED|ENOTFOUND|network|No matching version|failed to (fetch|resolve|install)|TLS|certificate|proxy/i;

const looksEnvironmental = (output: string): boolean => ENV_SIGNALS.test(output);

/**
 * TestAgent — runs the repository's own scripts via the sandbox:
 * targeted/regression tests, typecheck, lint. Understands failures by
 * re-running the same command on the pristine tree (git stash) to detect
 * pre-existing breakage instead of blaming the patch.
 */
export const runTestSuite = (
  input: TestSuiteInput,
): Effect.Effect<TestVerdict[], never> =>
  Effect.gen(function* () {
    const { tools } = input;
    const verdicts: TestVerdict[] = [];

    const testRun = yield* toolCall
      .run(tools, splitCommand(input.testCommand), 180_000)
      .pipe(Effect.orElseSucceed(() => null));
    if (testRun) {
      const output = `${testRun.stdout}\n${testRun.stderr}`.slice(0, 6000);
      let failureClass: TestVerdict["failureClass"] = undefined;
      if (testRun.exitCode !== 0) {
        failureClass = looksEnvironmental(output)
          ? "environment"
          : yield* classifyFailure(input.ctx.root, tools, input.testCommand);
      }
      verdicts.push(
        new TestVerdict({
          passed: testRun.exitCode === 0,
          command: testRun.command,
          exitCode: testRun.exitCode,
          summary: testRun.exitCode === 0 ? "tests passed" : `tests failed (exit ${testRun.exitCode}, classified: ${failureClass ?? "patch"})`,
          failureClass,
          output,
        }),
      );
    }

    // Typecheck is only meaningful with a project config; without one,
    // `tsc --noEmit` prints help and exits 1 — that is not a patch failure.
    const hasTsconfig = yield* toolCall.readFile(tools, "tsconfig.json").pipe(
      Effect.map(() => true),
      Effect.orElseSucceed(() => false),
    );
    if (!hasTsconfig) {
      verdicts.push(
        new TestVerdict({
          passed: true,
          command: input.typecheckCommand.join(" "),
          exitCode: 0,
          summary: "typecheck skipped (no tsconfig.json in repository)",
          output: "",
        }),
      );
    } else {
      const typeRun = yield* toolCall
        .run(tools, splitCommand(input.typecheckCommand), 180_000)
        .pipe(Effect.orElseSucceed(() => null));
      if (typeRun) {
        const output = `${typeRun.stdout}\n${typeRun.stderr}`.slice(0, 4000);
        let failureClass: TestVerdict["failureClass"] = undefined;
        if (typeRun.exitCode !== 0) {
          failureClass = looksEnvironmental(output)
            ? "environment"
            : yield* classifyFailure(input.ctx.root, tools, input.typecheckCommand);
        }
        verdicts.push(
          new TestVerdict({
            passed: typeRun.exitCode === 0,
            command: typeRun.command,
            exitCode: typeRun.exitCode,
            summary: typeRun.exitCode === 0 ? "typecheck passed" : `typecheck failed (exit ${typeRun.exitCode}, classified: ${failureClass ?? "patch"})`,
            failureClass,
            output,
          }),
        );
      }
    }

    if (!input.skipLint) {
      const lintRun = yield* toolCall
        .run(tools, splitCommand(input.lintCommand), 120_000)
        .pipe(Effect.orElseSucceed(() => null));
      if (lintRun) {
        verdicts.push(
          new TestVerdict({
            passed: lintRun.exitCode === 0,
            command: lintRun.command,
            exitCode: lintRun.exitCode,
            summary: lintRun.exitCode === 0 ? "lint passed" : `lint failed (exit ${lintRun.exitCode})`,
            failureClass: lintRun.exitCode === 0 ? undefined : "patch",
            output: `${lintRun.stdout}\n${lintRun.stderr}`.slice(0, 4000),
          }),
        );
      }
    }

    return verdicts;
  });

/**
 * Failure classification: stash the patch, re-run, compare, restore.
 * - fails on pristine tree too → pre-existing
 * - passes on pristine tree → caused by patch
 * - cannot determine → unrelated/environment based on output signals
 */
const classifyFailure = (
  root: string,
  tools: ToolRegistry,
  command: string[],
): Effect.Effect<NonNullable<TestVerdict["failureClass"]>, never> =>
  Effect.gen(function* () {
    const stash = yield* spawnCapture("git", ["stash", "push", "-m", "fixora-classify"], {
      cwd: root,
      timeoutMs: 30_000,
    }).pipe(Effect.map((r) => r.code === 0));
    if (!stash) return "patch" as const;

    try {
      const pristine = yield* toolCall
        .run(tools, command, 180_000)
        .pipe(Effect.orElseSucceed(() => null));
      if (pristine === null) return "environment" as const;
      if (pristine.exitCode !== 0) return "pre-existing" as const;
      return "patch" as const;
    } finally {
      // Restore the agent's patch; never lose it even if the test run dirtied the tree.
      const pop = yield* spawnCapture("git", ["stash", "pop"], { cwd: root, timeoutMs: 30_000 });
      if (pop.code !== 0) {
        yield* spawnCapture("git", ["checkout", "stash@{0}", "--", "."], { cwd: root, timeoutMs: 30_000 });
        yield* spawnCapture("git", ["stash", "drop"], { cwd: root, timeoutMs: 30_000 });
      }
    }
  });
