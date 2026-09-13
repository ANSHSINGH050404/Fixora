import { randomBytes } from "node:crypto";
import { Context, Effect, Layer, Ref } from "effect";
import { StoreError } from "../domain/errors";
import { transition as validateTransition } from "../domain/state-machine";

/** Plain records exchanged with the store (shared by both backends). */
export interface RepositoryRecord {
  readonly id: string;
  readonly url: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
}

export interface IssueRecord {
  readonly id: string;
  readonly repositoryId: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: string;
  readonly labels: string[];
}

export interface TaskRecord {
  readonly id: string;
  readonly repositoryId: string;
  readonly issueId: string;
  readonly branch: string | null;
  readonly status: string;
  readonly currentStage: string | null;
  readonly attempt: number;
  readonly summary: string | null;
  readonly error: string | null;
  readonly isPublic: number;
  readonly shareToken: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StepRecord {
  readonly id: string;
  readonly taskId: string;
  readonly type: string;
  readonly status: string;
  readonly summary: string;
  readonly inputMetadata: unknown;
  readonly outputMetadata: unknown;
  readonly durationMs: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly error: string | null;
}

export interface TransitionRecord {
  readonly id: string;
  readonly taskId: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface HypothesisRecord {
  readonly id: string;
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly confidence: number;
  readonly status: string;
  readonly conclusion: string | null;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly taskId: string;
  readonly hypothesisId: string | null;
  readonly kind: string;
  readonly file: string | null;
  readonly line: number | null;
  readonly snippet: string;
  readonly detail: string;
}

export interface PatchRecord {
  readonly id: string;
  readonly taskId: string;
  readonly description: string;
  readonly diff: string;
  readonly filesChanged: string[];
  readonly additions: number;
  readonly deletions: number;
  readonly status: string;
}

export interface TestRunRecord {
  readonly id: string;
  readonly taskId: string;
  readonly kind: string;
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly passed: number;
}

export interface ReviewRecord {
  readonly id: string;
  readonly taskId: string;
  readonly approved: number;
  readonly severity: string;
  readonly findings: unknown[];
  readonly summary: string;
}

export interface PullRequestRecord {
  readonly id: string;
  readonly taskId: string;
  readonly branch: string;
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly number: number | null;
  readonly status: string;
}

export interface CreateTaskInput {
  readonly repositoryUrl: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly issueNumber: number;
  readonly issueTitle: string;
  readonly issueBody: string;
  readonly issueState: string;
  readonly issueLabels: string[];
  readonly branch?: string;
  readonly hasUserToken: boolean;
}

export interface TaskStoreApi {
  readonly createTask: (input: CreateTaskInput) => Effect.Effect<TaskRecord, StoreError>;
  readonly getTask: (id: string) => Effect.Effect<TaskRecord, StoreError>;
  readonly listTasks: (limit?: number) => Effect.Effect<TaskRecord[], StoreError>;
  readonly listRepositories: () => Effect.Effect<RepositoryRecord[], StoreError>;
  readonly getIssue: (task: TaskRecord) => Effect.Effect<IssueRecord, StoreError>;
  readonly getRepository: (task: TaskRecord) => Effect.Effect<RepositoryRecord, StoreError>;
  /** Validated state transition; records into the transition log. */
  readonly setStatus: (
    taskId: string,
    to: string,
    reason?: string,
  ) => Effect.Effect<TaskRecord, StoreError>;
  readonly setStage: (taskId: string, stage: string | null) => Effect.Effect<void, StoreError>;
  /**
   * Toggle public sharing. Enabling mints a stable unguessable share token
   * (kept across disable/enable); returns the token when public, null when private.
   */
  readonly setTaskPublic: (taskId: string, isPublic: boolean) => Effect.Effect<string | null, StoreError>;
  /** Capability lookup for public pages; fails when unknown OR not public. */
  readonly getTaskByShareToken: (token: string) => Effect.Effect<TaskRecord, StoreError>;
  readonly incrementAttempt: (taskId: string) => Effect.Effect<number, StoreError>;
  readonly failTask: (taskId: string, error: string) => Effect.Effect<void, StoreError>;
  readonly beginStep: (
    taskId: string,
    type: string,
    inputMetadata?: unknown,
  ) => Effect.Effect<StepRecord, StoreError>;
  readonly endStep: (
    stepId: string,
    args: { status: string; summary: string; outputMetadata?: unknown; error?: string },
  ) => Effect.Effect<void, StoreError>;
  readonly listSteps: (taskId: string) => Effect.Effect<StepRecord[], StoreError>;
  readonly listTransitions: (taskId: string) => Effect.Effect<TransitionRecord[], StoreError>;
  readonly saveHypotheses: (
    taskId: string,
    hyps: ReadonlyArray<{ title: string; description: string; confidence: number }>,
  ) => Effect.Effect<HypothesisRecord[], StoreError>;
  readonly setHypothesisStatus: (
    id: string,
    status: string,
    conclusion?: string,
  ) => Effect.Effect<void, StoreError>;
  readonly listHypotheses: (taskId: string) => Effect.Effect<HypothesisRecord[], StoreError>;
  readonly saveEvidence: (
    taskId: string,
    items: ReadonlyArray<{
      hypothesisId?: string;
      kind: string;
      file?: string;
      line?: number;
      snippet: string;
      detail: string;
    }>,
  ) => Effect.Effect<void, StoreError>;
  readonly listEvidence: (taskId: string) => Effect.Effect<EvidenceRecord[], StoreError>;
  readonly snapshotFile: (taskId: string, path: string, content: string, sha?: string) => Effect.Effect<void, StoreError>;
  readonly savePatch: (
    taskId: string,
    patch: { description: string; diff: string; filesChanged: readonly string[]; additions: number; deletions: number },
  ) => Effect.Effect<PatchRecord, StoreError>;
  readonly getLatestPatch: (taskId: string) => Effect.Effect<PatchRecord | null, StoreError>;
  readonly saveTestRun: (
    taskId: string,
    run: { kind: string; command: string; exitCode: number | null; stdout: string; stderr: string; durationMs: number; passed: boolean },
  ) => Effect.Effect<void, StoreError>;
  readonly listTestRuns: (taskId: string) => Effect.Effect<TestRunRecord[], StoreError>;
  readonly saveReview: (
    taskId: string,
    review: { approved: boolean; severity: string; findings: readonly unknown[]; summary: string },
  ) => Effect.Effect<void, StoreError>;
  readonly getLatestReview: (taskId: string) => Effect.Effect<ReviewRecord | null, StoreError>;
  readonly savePRProposal: (
    taskId: string,
    pr: { branch: string; title: string; body: string },
  ) => Effect.Effect<PullRequestRecord, StoreError>;
  readonly markPRCreated: (taskId: string, url: string, number: number) => Effect.Effect<void, StoreError>;
  readonly getPR: (taskId: string) => Effect.Effect<PullRequestRecord | null, StoreError>;
}

export class TaskStore extends Context.Tag("TaskStore")<TaskStore, TaskStoreApi>() {}

// ---------------------------------------------------------------------------
// In-memory backend (tests, local demo without DATABASE_URL).
// ---------------------------------------------------------------------------

interface MemoryState {
  repos: Map<string, RepositoryRecord>;
  issues: Map<string, IssueRecord>;
  tasks: Map<string, TaskRecord>;
  steps: Map<string, StepRecord>;
  transitions: TransitionRecord[];
  hypotheses: Map<string, HypothesisRecord>;
  evidence: EvidenceRecord[];
  snapshots: Array<{ taskId: string; path: string; content: string }>;
  patches: Map<string, PatchRecord>;
  testRuns: TestRunRecord[];
  reviews: Map<string, ReviewRecord>;
  prs: Map<string, PullRequestRecord>;
  seq: number;
}

const freshState = (): MemoryState => ({
  repos: new Map(),
  issues: new Map(),
  tasks: new Map(),
  steps: new Map(),
  transitions: [],
  hypotheses: new Map(),
  evidence: [],
  snapshots: [],
  patches: new Map(),
  testRuns: [],
  reviews: new Map(),
  prs: new Map(),
  seq: 0,
});

const nid = (state: MemoryState, prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(state.seq++).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

const nowIso = (): string => new Date().toISOString();

/** Unguessable capability token for public share links (128-bit hex). */
const newShareToken = (): string => randomBytes(16).toString("hex");

const notFound = (op: string, id: string) =>
  new StoreError({ message: `not found: ${id}`, operation: op });

export const TaskStoreMemoryLive: Layer.Layer<TaskStore> = Layer.effect(
  TaskStore,
  Effect.gen(function* () {
    const ref = yield* Ref.make<MemoryState>(freshState());

    const api: TaskStoreApi = {
      createTask: (input) =>
        ref.modify((s) => {
          const repoId = nid(s, "repo");
          const issueId = nid(s, "issue");
          const taskId = nid(s, "task");
          const repo: RepositoryRecord = {
            id: repoId,
            url: input.repositoryUrl,
            owner: input.owner,
            name: input.name,
            defaultBranch: input.defaultBranch,
          };
          const issue: IssueRecord = {
            id: issueId,
            repositoryId: repoId,
            number: input.issueNumber,
            title: input.issueTitle,
            body: input.issueBody,
            state: input.issueState,
            labels: input.issueLabels,
          };
          const task: TaskRecord = {
            id: taskId,
            repositoryId: repoId,
            issueId,
            branch: input.branch ?? null,
            status: "QUEUED",
            currentStage: null,
            attempt: 0,
            summary: null,
            error: null,
            isPublic: 0,
            shareToken: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          s.repos.set(repoId, repo);
          s.issues.set(issueId, issue);
          s.tasks.set(taskId, task);
          s.transitions.push({
            id: nid(s, "tr"),
            taskId,
            from: "NONE",
            to: "QUEUED",
            reason: "task created",
            createdAt: nowIso(),
          });
          return [task, s] as const;
        }),
      getTask: (id) =>
        Effect.flatMap(Ref.get(ref), (s) => {
          const t = s.tasks.get(id);
          return t ? Effect.succeed(t) : Effect.fail(notFound("getTask", id));
        }),
      listTasks: (limit = 50) =>
        Effect.map(Ref.get(ref), (s) =>
          [...s.tasks.values()]
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
            .slice(0, limit),
        ),
      listRepositories: () =>
        Effect.map(Ref.get(ref), (s) => [...s.repos.values()]),
      getIssue: (task) =>
        Effect.flatMap(Ref.get(ref), (s) => {
          const i = s.issues.get(task.issueId);
          return i ? Effect.succeed(i) : Effect.fail(notFound("getIssue", task.issueId));
        }),
      getRepository: (task) =>
        Effect.flatMap(Ref.get(ref), (s) => {
          const r = s.repos.get(task.repositoryId);
          return r
            ? Effect.succeed(r)
            : Effect.fail(notFound("getRepository", task.repositoryId));
        }),
      setStatus: (taskId, to, reason = "") =>
        Effect.flatMap(Ref.get(ref), (s) => {
          const t = s.tasks.get(taskId);
          if (!t) return Effect.fail(notFound("setStatus", taskId));
          return Effect.as(
            Effect.zipRight(
              validateTransition(t.status, to).pipe(
                Effect.mapError(
                  (e) => new StoreError({ message: e.message, operation: "setStatus" }),
                ),
              ),
              Ref.update(ref, (s2) => {
                const cur = s2.tasks.get(taskId);
                if (!cur) return s2;
                s2.tasks.set(taskId, { ...cur, status: to, updatedAt: nowIso() });
                s2.transitions.push({
                  id: nid(s2, "tr"),
                  taskId,
                  from: cur.status,
                  to,
                  reason,
                  createdAt: nowIso(),
                });
                return s2;
              }),
            ),
            s.tasks.get(taskId) as TaskRecord,
          ).pipe(
            Effect.flatMap((updated) =>
              Ref.get(ref).pipe(Effect.map((s3) => s3.tasks.get(taskId) ?? updated)),
            ),
          );
        }),
      setStage: (taskId, stage) =>
        Ref.update(ref, (s) => {
          const t = s.tasks.get(taskId);
          if (t) s.tasks.set(taskId, { ...t, currentStage: stage, updatedAt: nowIso() });
          return s;
        }),
      setTaskPublic: (taskId, isPublic) =>
        Effect.flatMap(Ref.get(ref), (s) => {
          const t = s.tasks.get(taskId);
          if (!t) return Effect.fail(notFound("setTaskPublic", taskId));
          return ref.modify((s2) => {
            const cur = s2.tasks.get(taskId);
            if (!cur) return [null, s2] as const;
            const token = cur.shareToken ?? (isPublic ? newShareToken() : null);
            s2.tasks.set(taskId, { ...cur, isPublic: isPublic ? 1 : 0, shareToken: token, updatedAt: nowIso() });
            return [isPublic ? token : null, s2] as const;
          });
        }),
      getTaskByShareToken: (token) =>
        Effect.flatMap(Ref.get(ref), (s) => {
          const t = [...s.tasks.values()].find((x) => x.shareToken === token && x.isPublic === 1);
          return t ? Effect.succeed(t) : Effect.fail(notFound("getTaskByShareToken", "shared task"));
        }),
      incrementAttempt: (taskId) =>
        ref.modify((s) => {
          const t = s.tasks.get(taskId);
          const next = (t?.attempt ?? 0) + 1;
          if (t) s.tasks.set(taskId, { ...t, attempt: next });
          return [next, s] as const;
        }),
      failTask: (taskId, error) =>
        Ref.update(ref, (s) => {
          const t = s.tasks.get(taskId);
          if (t && t.status !== "FAILED") {
            s.tasks.set(taskId, { ...t, status: "FAILED", error, updatedAt: nowIso() });
            s.transitions.push({
              id: nid(s, "tr"),
              taskId,
              from: t.status,
              to: "FAILED",
              reason: error.slice(0, 500),
              createdAt: nowIso(),
            });
          } else if (t) {
            s.tasks.set(taskId, { ...t, error, updatedAt: nowIso() });
          }
          return s;
        }),
      beginStep: (taskId, type, inputMetadata = {}) =>
        ref.modify((s) => {
          const step: StepRecord = {
            id: nid(s, "step"),
            taskId,
            type,
            status: "running",
            summary: "",
            inputMetadata,
            outputMetadata: {},
            durationMs: null,
            startedAt: nowIso(),
            completedAt: null,
            error: null,
          };
          s.steps.set(step.id, step);
          return [step, s] as const;
        }),
      endStep: (stepId, args) =>
        Ref.update(ref, (s) => {
          const st = s.steps.get(stepId);
          if (!st) return s;
          const started = new Date(st.startedAt).getTime();
          s.steps.set(stepId, {
            ...st,
            status: args.status,
            summary: args.summary,
            outputMetadata: args.outputMetadata ?? {},
            error: args.error ?? null,
            completedAt: nowIso(),
            durationMs: Date.now() - started,
          });
          return s;
        }),
      listSteps: (taskId) =>
        Effect.map(Ref.get(ref), (s) =>
          [...s.steps.values()]
            .filter((st) => st.taskId === taskId)
            .sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)),
        ),
      listTransitions: (taskId) =>
        Effect.map(Ref.get(ref), (s) =>
          s.transitions.filter((t) => t.taskId === taskId),
        ),
      saveHypotheses: (taskId, hyps) =>
        ref.modify((s) => {
          const rows = hyps.map((h) => {
            const row: HypothesisRecord = {
              id: nid(s, "hyp"),
              taskId,
              title: h.title,
              description: h.description,
              confidence: h.confidence,
              status: "proposed",
              conclusion: null,
            };
            s.hypotheses.set(row.id, row);
            return row;
          });
          return [rows, s] as const;
        }),
      setHypothesisStatus: (id, status, conclusion) =>
        Ref.update(ref, (s) => {
          const h = s.hypotheses.get(id);
          if (h) s.hypotheses.set(id, { ...h, status, conclusion: conclusion ?? h.conclusion });
          return s;
        }),
      listHypotheses: (taskId) =>
        Effect.map(Ref.get(ref), (s) =>
          [...s.hypotheses.values()].filter((h) => h.taskId === taskId),
        ),
      saveEvidence: (taskId, items) =>
        Ref.update(ref, (s) => {
          for (const it of items) {
            s.evidence.push({
              id: nid(s, "ev"),
              taskId,
              hypothesisId: it.hypothesisId ?? null,
              kind: it.kind,
              file: it.file ?? null,
              line: it.line ?? null,
              snippet: it.snippet,
              detail: it.detail,
            });
          }
          return s;
        }),
      listEvidence: (taskId) =>
        Effect.map(Ref.get(ref), (s) => s.evidence.filter((e) => e.taskId === taskId)),
      snapshotFile: (taskId, path, content) =>
        Ref.update(ref, (s) => {
          s.snapshots.push({ taskId, path, content });
          return s;
        }),
      savePatch: (taskId, patch) =>
        ref.modify((s) => {
          const row: PatchRecord = {
            id: nid(s, "patch"),
            taskId,
            description: patch.description,
            diff: patch.diff,
            filesChanged: [...patch.filesChanged],
            additions: patch.additions,
            deletions: patch.deletions,
            status: "proposed",
          };
          s.patches.set(row.id, row);
          return [row, s] as const;
        }),
      getLatestPatch: (taskId) =>
        Effect.map(Ref.get(ref), (s) => {
          const rows = [...s.patches.values()].filter((p) => p.taskId === taskId);
          return rows.length > 0 ? rows[rows.length - 1] : null;
        }),
      saveTestRun: (taskId, run) =>
        Ref.update(ref, (s) => {
          s.testRuns.push({
            id: nid(s, "test"),
            taskId,
            kind: run.kind,
            command: run.command,
            exitCode: run.exitCode,
            stdout: run.stdout,
            stderr: run.stderr,
            durationMs: run.durationMs,
            passed: run.passed ? 1 : 0,
          });
          return s;
        }),
      listTestRuns: (taskId) =>
        Effect.map(Ref.get(ref), (s) => s.testRuns.filter((t) => t.taskId === taskId)),
      saveReview: (taskId, review) =>
        Ref.update(ref, (s) => {
          s.reviews.set(taskId, {
            id: nid(s, "rev"),
            taskId,
            approved: review.approved ? 1 : 0,
            severity: review.severity,
            findings: [...review.findings],
            summary: review.summary,
          });
          return s;
        }),
      getLatestReview: (taskId) =>
        Effect.map(Ref.get(ref), (s) => s.reviews.get(taskId) ?? null),
      savePRProposal: (taskId, pr) =>
        ref.modify((s) => {
          const row: PullRequestRecord = {
            id: nid(s, "pr"),
            taskId,
            branch: pr.branch,
            title: pr.title,
            body: pr.body,
            url: null,
            number: null,
            status: "proposed",
          };
          s.prs.set(taskId, row);
          return [row, s] as const;
        }),
      markPRCreated: (taskId, url, number) =>
        Ref.update(ref, (s) => {
          const pr = s.prs.get(taskId);
          if (pr) s.prs.set(taskId, { ...pr, url, number, status: "created" });
          return s;
        }),
      getPR: (taskId) => Effect.map(Ref.get(ref), (s) => s.prs.get(taskId) ?? null),
    };

    return api;
  }),
);
