import { Effect, Schedule } from "effect";
import type { AgentContext } from "../agents/tools";
import { AgentStageError, RepositoryAnalysisError } from "../domain/errors";
import { spawnCapture } from "../services/process";
import {
  FixPlan,
  Hypothesis,
  IssueAnalysis,
  PRProposal,
  ReproductionResult,
  RepositoryMap,
  ReviewResult,
  TestVerdict,
  type CodeFinding,
} from "../domain/schemas";
import { STAGE_FOR_STATUS } from "../domain/state-machine";
import { SettingsService } from "../services/settings";
import { GitHubService } from "../services/github";
import { LLMService } from "../services/llm";
import { logStep } from "../services/logger";
import { mapRepository } from "../services/mapper";
import { RepositoryService } from "../services/repository";
import { SandboxService } from "../services/sandbox";
import { TaskStore, type TaskRecord } from "../services/store-memory";
import { analyzeIssue as runIssueAnalyzer } from "../agents/issue-analyzer";
import { exploreCode, inspectHistory } from "../agents/explorer";
import { analyzeRootCause, generateHypotheses } from "../agents/hypotheses";
import { reproduceBug } from "../agents/reproducer";
import { planFix } from "../agents/fix-planner";
import { buildRegistry } from "../agents/tool-wiring";
import { implementFix } from "../agents/implementation";
import { runTestSuite } from "../agents/test-agent";
import { reviewPatch } from "../agents/reviewer";
import { generatePRProposal } from "../agents/pr-generator";

export type WorkflowServices =
  | TaskStore
  | GitHubService
  | RepositoryService
  | SandboxService
  | LLMService
  | SettingsService;

const stageRetry = Schedule.intersect(
  Schedule.exponential("1 second"),
  Schedule.recurs(2),
);

/** Run one pipeline stage with step recording, transition, retry, timeout. */
const stage = <A>(
  task: TaskRecord,
  toStatus: string,
  inputMetadata: unknown,
  run: Effect.Effect<A, AgentStageError, WorkflowServices>,
): Effect.Effect<A, AgentStageError, WorkflowServices> =>
  Effect.gen(function* () {
    const store = yield* TaskStore;
    const to = toStatus;
    const current = yield* store.getTask(task.id).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: to, message: e.message })),
    );
    if (current.status !== to) {
      yield* store.setStatus(task.id, to, `entering ${to}`).pipe(
        Effect.mapError((e) => new AgentStageError({ stage: to, message: e.message })),
      );
    }
    const stageName = STAGE_FOR_STATUS[to] ?? to;
    yield* store.setStage(task.id, stageName).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: to, message: e.message })),
    );
    yield* logStep(task.id, stageName, "started");
    const step = yield* store.beginStep(task.id, stageName, inputMetadata).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: to, message: e.message })),
    );
    const started = Date.now();
    const result = yield* run.pipe(
      Effect.retry({ schedule: stageRetry, while: (e) => e._tag === "AgentStageError" }),
      Effect.timeoutFail({
        duration: "10 minutes",
        onTimeout: () => new AgentStageError({ stage: stageName, message: `${stageName} timed out after 10 minutes` }),
      }),
      Effect.either,
    );
    if (result._tag === "Left") {
      const message = result.left.message;
      yield* store.endStep(step.id, { status: "failed", summary: `${stageName} failed: ${message}`, error: message }).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      yield* logStep(task.id, stageName, "failed", { error: message });
      return yield* Effect.fail(result.left);
    }
    yield* store.endStep(step.id, {
      status: "success",
      summary: summarizeStage(stageName, result.right),
      outputMetadata: safeMeta(result.right),
    }).pipe(Effect.orElseSucceed(() => undefined));
    yield* logStep(task.id, stageName, "success", { durationMs: Date.now() - started });
    return result.right;
  }).pipe(
    Effect.catchAll((e: AgentStageError) => Effect.fail(e)),
  ) as Effect.Effect<A, AgentStageError, WorkflowServices>;

const safeMeta = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "string" && v.length > 4000 ? v.slice(0, 4000) + "…[truncated]" : v)));
  } catch {
    return { note: "unserializable output" };
  }
};

const summarizeStage = (stageName: string, result: unknown): string => {
  if (result !== null && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (stageName === "ISSUE_ANALYSIS") return `Issue analyzed: ${(r.summary as string ?? "").slice(0, 140)}`;
    if (stageName === "REPOSITORY_MAPPING") return `Repository mapped: ${(r as { map?: { framework?: string } }).map?.framework ?? "unknown framework"}`;
    if (stageName === "CODE_EXPLORATION" && Array.isArray(result)) return `${(result as unknown[]).length} relevant code findings`;
    if (stageName === "HYPOTHESIS_GENERATION" && Array.isArray(result)) return `${(result as unknown[]).length} hypotheses generated`;
    if (stageName === "BUG_REPRODUCTION") return (r.result as { reproduced?: boolean; method?: string } | undefined)?.reproduced ? `Bug reproduced: ${String((r.result as { method?: string }).method ?? "")}`.slice(0, 160) : "No executable reproduction; static evidence recorded";
    if (stageName === "ROOT_CAUSE_ANALYSIS") return `Root cause: ${String((r.confirmed as { title?: string } | undefined)?.title ?? "identified").slice(0, 140)}`;
    if (stageName === "FIX_PLANNING") return `Fix plan: ${(r.changes as string[] | undefined)?.length ?? 0} changes across ${(r.files as string[] | undefined)?.length ?? 0} files`;
    if (stageName === "IMPLEMENTATION") return `Patch applied (${(r.method as string) ?? "validated-edit"}): ${(r.edits as unknown[] | undefined)?.length ?? 0} edit(s)`;
    if (stageName === "TEST_EXECUTION" && Array.isArray(result)) return (result as TestVerdict[]).every((v) => v.passed) ? "All checks passed" : `${(result as TestVerdict[]).filter((v) => !v.passed).length} check(s) failed`;
    if (stageName === "CODE_REVIEW") return (r.approved as boolean) ? `Review approved (severity: ${String(r.severity)})` : `Review requested changes (severity: ${String(r.severity)})`;
    if (stageName === "PR_PROPOSAL") return `PR proposed: ${String((r as { branch?: string }).branch ?? "")}`;
  }
  return `${stageName} completed`;
};

export interface RunTaskOptions {
  readonly token?: string;
  /** Local fixture directory (demo mode) — copied to the workspace instead of cloning. */
  readonly localPath?: string;
}

/**
 * The complete engineering lifecycle. Ends at READY_FOR_PR and waits for
 * explicit user approval — it never pushes or opens a PR by itself.
 */
export const runTask = (
  taskId: string,
  opts: RunTaskOptions = {},
): Effect.Effect<void, never, WorkflowServices> =>
  Effect.gen(function* () {
    const store = yield* TaskStore;
    const github = yield* GitHubService;
    const repoSvc = yield* RepositoryService;
    const settings = yield* SettingsService;

    const task = yield* store.getTask(taskId).pipe(Effect.orElseSucceed(() => null));
    if (!task) return;
    if (task.status !== "QUEUED") return;

    const fail = (message: string) =>
      Effect.gen(function* () {
        yield* store.failTask(taskId, message).pipe(Effect.orElseSucceed(() => undefined));
        yield* logStep(taskId, "WORKFLOW", "failed", { error: message });
      });

    const pipeline = Effect.gen(function* () {
      // Hot-configured repair budget, resolved when the run starts.
      const { maxRepairAttempts } = yield* settings.getEffective().pipe(
        Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: e.message })),
      );
      const repository = yield* store.getRepository(task).pipe(
        Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: e.message })),
      );
      const issue = yield* store.getIssue(task).pipe(
        Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: e.message })),
      );

      // --- Setup: fresh issue data + local checkout ---------------------
      let issueTitle = issue.title;
      let issueBody = issue.body;
      let issueLabels = issue.labels;
      let issueComments: Array<{ author: string; body: string }> = [];
      let defaultBranch = repository.defaultBranch || "main";
      let root: string;

      if (opts.localPath) {
        const dest = yield* repoSvc.workspaceFor("local-demo", task.id.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 24) || "task").pipe(
          Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: e.message })),
        );
        yield* copyFixture(opts.localPath, dest).pipe(
          Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: e.message })),
        );
        root = dest;
      } else {
        const fresh = yield* github.getIssue(repository.owner, repository.name, issue.number, opts.token).pipe(
          Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: `cannot fetch issue: ${e.message}` })),
        );
        issueTitle = fresh.title;
        issueBody = fresh.body;
        issueLabels = fresh.labels;
        issueComments = fresh.comments;
        const info = yield* github.getRepository(repository.owner, repository.name, opts.token).pipe(
          Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: `cannot fetch repo: ${e.message}` })),
        );
        defaultBranch = task.branch ?? info.defaultBranch;
        root = yield* repoSvc.ensureClone(repository.owner, repository.name, defaultBranch, opts.token).pipe(
          Effect.mapError((e) => new AgentStageError({ stage: "SETUP", message: e.message })),
        );
      }

      const ctx: AgentContext = {
        taskId,
        token: opts.token,
        owner: repository.owner,
        name: repository.name,
        branch: defaultBranch,
        root,
      };

      // Agent-facing tool registry: stages request named, schema-validated
      // tools instead of touching infrastructure directly.
      const tools = yield* buildRegistry(ctx);

      // --- 1. Issue analysis --------------------------------------------
      const analysis: IssueAnalysis = yield* stage(task, "ANALYZING_ISSUE", { issue: issue.number }, runIssueAnalyzer({
        title: issueTitle,
        body: issueBody,
        labels: issueLabels,
        comments: issueComments,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "ISSUE_ANALYSIS", message: String(e) }))));

      // --- 2. Repository mapping -----------------------------------------
      const mapped = yield* stage(task, "MAPPING_REPOSITORY", { keywords: analysis.keywords }, mapRepository(root, analysis.keywords).pipe(
        Effect.mapError((e) => new AgentStageError({ stage: "REPOSITORY_MAPPING", message: String(e) })),
      ));
      const map: RepositoryMap = mapped.map;

      // --- 3. Code exploration -------------------------------------------
      const findings: CodeFinding[] = yield* stage(task, "EXPLORING_CODE", { importantFiles: mapped.importantFiles }, exploreCode({
        tools,
        analysis,
        importantFiles: mapped.importantFiles,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "CODE_EXPLORATION", message: String(e) }))));
      for (const f of findings.slice(0, 10)) {
        yield* store.snapshotFile(taskId, f.file, f.snippet).pipe(Effect.orElseSucceed(() => undefined));
      }
      const history = yield* inspectHistory({ tools, files: findings.slice(0, 5).map((f) => f.file) }).pipe(
        Effect.orElseSucceed(() => []),
      );
      const historyNotes = history.flatMap((h) => h.commits.map((c) => `${h.file}@${c.sha}: ${c.message}`));

      // --- 4. Hypotheses ---------------------------------------------------
      const hypotheses: Hypothesis[] = yield* stage(task, "GENERATING_HYPOTHESES", { findingCount: findings.length }, generateHypotheses({
        analysis,
        findings,
        historyNotes,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "HYPOTHESIS_GENERATION", message: String(e) }))));
      const savedHyps = yield* store.saveHypotheses(taskId, hypotheses.map((h) => ({ title: h.title, description: h.description, confidence: h.confidence }))).pipe(
        Effect.orElseSucceed(() => []),
      );
      const hypById = new Map(hypotheses.map((h, i) => [h.id, savedHyps[i]?.id ?? h.id]));
      yield* store.saveEvidence(taskId, findings.slice(0, 12).map((f) => ({
        kind: "OBSERVATION",
        file: f.file,
        line: f.line ?? undefined,
        snippet: f.snippet.slice(0, 1000),
        detail: f.relevance,
      }))).pipe(Effect.orElseSucceed(() => undefined));

      // --- 5. Reproduction -------------------------------------------------
      const repro = yield* stage(task, "REPRODUCING", { hypotheses: hypotheses.length }, reproduceBug({
        ctx,
        tools,
        analysis,
        map,
        findings,
        hypotheses,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "BUG_REPRODUCTION", message: String(e) }))));
      const reproduction: ReproductionResult = repro.result;
      void repro;

      // --- 6. Root cause ---------------------------------------------------
      const rootCauseOut = yield* stage(task, "ANALYZING_ROOT_CAUSE", { reproduced: reproduction.reproduced }, analyzeRootCause({
        hypotheses,
        reproduction,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "ROOT_CAUSE_ANALYSIS", message: String(e) }))));
      const confirmedDbId = hypById.get(rootCauseOut.confirmed.id);
      if (confirmedDbId) {
        yield* store.setHypothesisStatus(confirmedDbId, "confirmed", rootCauseOut.confirmed.description).pipe(Effect.orElseSucceed(() => undefined));
      }
      for (const r of rootCauseOut.rejected) {
        const id = hypById.get(r.id);
        if (id) {
          yield* store.setHypothesisStatus(id, "rejected", "weighed against reproduction evidence").pipe(Effect.orElseSucceed(() => undefined));
        }
      }

      // --- 7. Fix plan (gate: implementation forbidden before this) --------
      const plan: FixPlan = yield* stage(task, "PLANNING_FIX", { rootCause: rootCauseOut.confirmed.title }, planFix({
        analysis,
        rootCause: rootCauseOut.confirmed,
        reproduction,
        findings,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "FIX_PLANNING", message: String(e) }))));

      // --- 8-10. Implement → test → review with self-repair loop ----------
      const validateCommand = ["bun", "test"] as string[];
      let verdicts: TestVerdict[] = [];
      let review: ReviewResult | null = null;
      let diff = "";
      let method = "";

      for (let attempt = 1; attempt <= maxRepairAttempts; attempt++) {
        yield* store.incrementAttempt(taskId).pipe(Effect.orElseSucceed(() => 0));

        const impl = yield* stage(task, "IMPLEMENTING", { attempt, plan: plan.changes }, implementFix({
          ctx,
          tools,
          plan,
          rootCause: rootCauseOut.confirmed,
          evidenceLines: findings.slice(0, 6).map((f) => ({ file: f.file, line: f.line ?? undefined })),
          validateCommand,
        }).pipe(
          Effect.mapError((e) => new AgentStageError({ stage: "IMPLEMENTATION", message: e.message })),
        ));
        diff = impl.diff;
        method = impl.method;

        verdicts = yield* stage(task, "RUNNING_TESTS", { attempt, method }, runTestSuite({
          ctx,
          tools,
          testCommand: [map.testCommand.split(" ")[0], ...map.testCommand.split(" ").slice(1)],
          typecheckCommand: [map.typecheckCommand.split(" ")[0], ...map.typecheckCommand.split(" ").slice(1)],
          lintCommand: [map.lintCommand.split(" ")[0], ...map.lintCommand.split(" ").slice(1)],
          skipLint: true,
        }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "TEST_EXECUTION", message: String(e) }))));
        for (const v of verdicts) {
          yield* store.saveTestRun(taskId, {
            kind: v.command.includes("tsc") ? "typecheck" : "test",
            command: v.command,
            exitCode: v.exitCode,
            stdout: v.output.slice(0, 8000),
            stderr: "",
            durationMs: 0,
            passed: v.passed,
          }).pipe(Effect.orElseSucceed(() => undefined));
        }

        const patchFailed = verdicts.some((v) => !v.passed && v.failureClass !== "pre-existing" && v.failureClass !== "environment");
        if (patchFailed && attempt < maxRepairAttempts) {
          // Self-repair: revert candidate changes and retry implementation.
          yield* revertWorkdir(root);
          continue;
        }

        review = yield* stage(task, "REVIEWING", { attempt }, reviewPatch({
          diff,
          filesChanged: plan.files,
          testSummary: verdicts.map((v) => `${v.command}: ${v.passed ? "PASS" : "FAIL"}`).join("; "),
          fixDescription: `${plan.problem} — ${plan.rootCause}`,
        }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "CODE_REVIEW", message: String(e) }))));
        yield* store.saveReview(taskId, {
          approved: review.approved,
          severity: review.severity,
          findings: review.findings,
          summary: review.summary,
        }).pipe(Effect.orElseSucceed(() => undefined));

        if (!review.approved && attempt < maxRepairAttempts) {
          yield* revertWorkdir(root);
          continue;
        }
        break;
      }

      if (!review) {
        return yield* Effect.fail(new AgentStageError({ stage: "CODE_REVIEW", message: "review never completed" }));
      }
      const blockingTestFailure = verdicts.some((v) => !v.passed && (v.failureClass === "patch" || !v.failureClass));
      if (blockingTestFailure) {
        return yield* Effect.fail(new AgentStageError({ stage: "TEST_EXECUTION", message: "tests still failing after repair attempts" }));
      }
      if (!review.approved) {
        return yield* Effect.fail(new AgentStageError({ stage: "CODE_REVIEW", message: `review blocked: ${review.summary}` }));
      }

      // --- 11. PR proposal (no push without approval) -----------------------
      const proposal: PRProposal = yield* stage(task, "READY_FOR_PR", { method }, generatePRProposal({
        analysis,
        rootCause: rootCauseOut.confirmed,
        plan,
        reproduction,
        verdicts,
        review,
        diff,
        issueNumber: issue.number,
      }).pipe(Effect.mapError((e) => new AgentStageError({ stage: "PR_PROPOSAL", message: String(e) }))));
      yield* store.savePatch(taskId, {
        description: `${method}: ${rootCauseOut.confirmed.title}`,
        diff,
        filesChanged: proposal.filesChanged,
        additions: proposal.additions,
        deletions: proposal.deletions,
      }).pipe(Effect.orElseSucceed(() => undefined as never));
      yield* store.savePRProposal(taskId, { branch: proposal.branch, title: proposal.title, body: proposal.body }).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      yield* store.setStage(taskId, null).pipe(Effect.orElseSucceed(() => undefined));
    });

    const outcome = yield* pipeline.pipe(Effect.either);
    if (outcome._tag === "Left") {
      yield* fail(`${outcome.left.stage}: ${outcome.left.message}`);
    }
  });

const copyFixture = (from: string, to: string): Effect.Effect<void, RepositoryAnalysisError> =>
  Effect.tryPromise({
    try: async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rm(to, { recursive: true, force: true });
    await fs.mkdir(to, { recursive: true });
    const entries = await fs.readdir(from, { withFileTypes: true });
    const copy = async (src: string, dest: string): Promise<void> => {
      const items = await fs.readdir(src, { withFileTypes: true });
      await fs.mkdir(dest, { recursive: true });
      for (const it of items) {
        if (it.name === "node_modules" || it.name === ".git") continue;
        const s = path.join(src, it.name);
        const d = path.join(dest, it.name);
        if (it.isDirectory()) await copy(s, d);
        else await fs.copyFile(s, d);
      }
    };
    if (entries.length === 0) throw new Error(`demo fixture is empty: ${from}`);
    await copy(from, to);
    // Fresh git repo so diff/stash mechanics work.
    const init = await Effect.runPromise(spawnCapture("git", ["init", "-q"], { cwd: to, timeoutMs: 30_000 }));
    if (init.code !== 0) throw new Error(`git init failed: ${init.stderr.slice(0, 300)}`);
    const add = await Effect.runPromise(spawnCapture("git", ["add", "-A"], { cwd: to, timeoutMs: 30_000 }));
    if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.slice(0, 300)}`);
    const commit = await Effect.runPromise(
      spawnCapture("git", ["-c", "user.email=demo@local", "-c", "user.name=demo", "commit", "-qm", "fixture"], {
        cwd: to,
        timeoutMs: 30_000,
      }),
    );
    if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr.slice(0, 300)}`);
    },
    catch: (e) => new RepositoryAnalysisError({ message: e instanceof Error ? e.message : String(e) }),
  });

const revertWorkdir = (root: string): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    yield* spawnCapture("git", ["checkout", "--", "."], { cwd: root, timeoutMs: 30_000 });
    // Preserve generated repro scripts (regression evidence); drop other untracked noise.
    yield* spawnCapture("git", ["clean", "-fd", "-e", "repro-*.test.ts"], { cwd: root, timeoutMs: 30_000 });
  }).pipe(Effect.orElseSucceed(() => undefined));
