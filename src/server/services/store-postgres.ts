import { desc, eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Effect, Layer } from "effect";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import * as schema from "../db/schema";
import { StoreError } from "../domain/errors";
import { transition as validateTransition } from "../domain/state-machine";
import { AppConfigService } from "./config";
import {
  TaskStore,
  TaskStoreMemoryLive,
  type CreateTaskInput,
  type TaskRecord,
  type TaskStoreApi,
} from "./store-memory";

const fail = (operation: string, message: unknown): StoreError =>
  new StoreError({
    message: message instanceof Error ? message.message : String(message),
    operation,
  });

const toTask = (r: typeof schema.agentTasks.$inferSelect): TaskRecord => ({
  id: r.id,
  repositoryId: r.repositoryId,
  issueId: r.issueId,
  branch: r.branch,
  status: r.status,
  currentStage: r.currentStage,
  attempt: r.attempt,
  summary: r.summary,
  error: r.error,
  isPublic: r.isPublic,
  shareToken: r.shareToken,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** PostgreSQL-backed TaskStore. Requires DATABASE_URL. */
export const TaskStorePostgresLive: Layer.Layer<TaskStore, never, AppConfigService> =
  Layer.effect(
    TaskStore,
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      if (!config.databaseUrl) {
        return yield* Effect.die(
          new Error("TaskStorePostgresLive requires DATABASE_URL"),
        );
      }
      const client = postgres(config.databaseUrl, { max: 10 });
      const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });

      const wrap = <A>(operation: string, run: Promise<A>) =>
        Effect.tryPromise({
          try: () => run,
          catch: (e) => fail(operation, e),
        });

      const api: TaskStoreApi = {
        createTask: (input: CreateTaskInput) =>
          Effect.gen(function* () {
            const [repo] = yield* wrap("createTask.repo", db.insert(schema.repositories).values({
              url: input.repositoryUrl,
              owner: input.owner,
              name: input.name,
              defaultBranch: input.defaultBranch,
            }).returning());
            const [issue] = yield* wrap("createTask.issue", db.insert(schema.issues).values({
              repositoryId: repo.id,
              number: input.issueNumber,
              title: input.issueTitle,
              body: input.issueBody,
              state: input.issueState,
              labels: input.issueLabels,
            }).returning());
            const [task] = yield* wrap("createTask.task", db.insert(schema.agentTasks).values({
              repositoryId: repo.id,
              issueId: issue.id,
              branch: input.branch,
              hasUserToken: input.hasUserToken ? 1 : 0,
            }).returning());
            yield* wrap("createTask.transition", db.insert(schema.taskTransitions).values({
              taskId: task.id,
              from: "NONE",
              to: "QUEUED",
              reason: "task created",
            }));
            return toTask(task);
          }),
        getTask: (id) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getTask", db.select().from(schema.agentTasks).where(eq(schema.agentTasks.id, id)));
            if (rows.length === 0) return yield* Effect.fail(new StoreError({ message: `not found: ${id}`, operation: "getTask" }));
            return toTask(rows[0]);
          }),
        listTasks: (limit = 50) =>
          Effect.gen(function* () {
            const rows = yield* wrap("listTasks", db.select().from(schema.agentTasks).orderBy(desc(schema.agentTasks.createdAt)).limit(limit));
            return rows.map(toTask);
          }),
        listRepositories: () =>
          Effect.gen(function* () {
            const rows = yield* wrap("listRepositories", db.select().from(schema.repositories).orderBy(desc(schema.repositories.createdAt)).limit(100));
            return rows.map((r) => ({ id: r.id, url: r.url, owner: r.owner, name: r.name, defaultBranch: r.defaultBranch }));
          }),
        getIssue: (task) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getIssue", db.select().from(schema.issues).where(eq(schema.issues.id, task.issueId)));
            if (rows.length === 0) return yield* Effect.fail(new StoreError({ message: `not found: ${task.issueId}`, operation: "getIssue" }));
            const r = rows[0];
            return { id: r.id, repositoryId: r.repositoryId, number: r.number, title: r.title, body: r.body ?? "", state: r.state, labels: r.labels ?? [] };
          }),
        getRepository: (task) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getRepository", db.select().from(schema.repositories).where(eq(schema.repositories.id, task.repositoryId)));
            if (rows.length === 0) return yield* Effect.fail(new StoreError({ message: `not found: ${task.repositoryId}`, operation: "getRepository" }));
            const r = rows[0];
            return { id: r.id, url: r.url, owner: r.owner, name: r.name, defaultBranch: r.defaultBranch };
          }),
        setStatus: (taskId, to, reason = "") =>
          Effect.gen(function* () {
            const current = yield* api.getTask(taskId);
            yield* validateTransition(current.status, to).pipe(
              Effect.mapError((e) => new StoreError({ message: e.message, operation: "setStatus" })),
            );
            const [updated] = yield* wrap("setStatus", db.update(schema.agentTasks).set({ status: to, updatedAt: new Date() }).where(eq(schema.agentTasks.id, taskId)).returning());
            yield* wrap("setStatus.transition", db.insert(schema.taskTransitions).values({ taskId, from: current.status, to, reason }));
            return toTask(updated);
          }),
        setStage: (taskId, stage) =>
          Effect.as(wrap("setStage", db.update(schema.agentTasks).set({ currentStage: stage, updatedAt: new Date() }).where(eq(schema.agentTasks.id, taskId))), undefined),
        setTaskPublic: (taskId, isPublic) =>
          Effect.gen(function* () {
            const current = yield* api.getTask(taskId);
            const token = current.shareToken ?? (isPublic ? randomBytes(16).toString("hex") : null);
            const [updated] = yield* wrap(
              "setTaskPublic",
              db.update(schema.agentTasks).set({ isPublic: isPublic ? 1 : 0, shareToken: token, updatedAt: new Date() }).where(eq(schema.agentTasks.id, taskId)).returning(),
            );
            return isPublic ? updated.shareToken : null;
          }),
        getTaskByShareToken: (token) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getTaskByShareToken", db.select().from(schema.agentTasks).where(eq(schema.agentTasks.shareToken, token)));
            const row = rows.find((r) => r.isPublic === 1);
            if (!row) return yield* Effect.fail(new StoreError({ message: "not found: shared task", operation: "getTaskByShareToken" }));
            return toTask(row);
          }),
        incrementAttempt: (taskId) =>
          Effect.gen(function* () {
            const t = yield* api.getTask(taskId);
            yield* wrap("incrementAttempt", db.update(schema.agentTasks).set({ attempt: t.attempt + 1 }).where(eq(schema.agentTasks.id, taskId)));
            return t.attempt + 1;
          }),
        failTask: (taskId, error) =>
          Effect.gen(function* () {
            const t = yield* api.getTask(taskId);
            const to = "FAILED";
            if (t.status !== to) {
              yield* wrap("failTask.transition", db.insert(schema.taskTransitions).values({ taskId, from: t.status, to, reason: error.slice(0, 500) }));
            }
            yield* wrap("failTask", db.update(schema.agentTasks).set({ status: to, error, updatedAt: new Date() }).where(eq(schema.agentTasks.id, taskId)));
          }),
        beginStep: (taskId, type, inputMetadata = {}) =>
          Effect.gen(function* () {
            const [row] = yield* wrap("beginStep", db.insert(schema.agentSteps).values({ taskId, type, status: "running", inputMetadata }).returning());
            return {
              id: row.id, taskId: row.taskId, type: row.type, status: row.status,
              summary: row.summary, inputMetadata: row.inputMetadata, outputMetadata: row.outputMetadata,
              durationMs: row.durationMs, startedAt: row.startedAt.toISOString(),
              completedAt: null, error: null,
            };
          }),
        endStep: (stepId, args) =>
          Effect.as(wrap("endStep", db.update(schema.agentSteps).set({
            status: args.status, summary: args.summary,
            outputMetadata: args.outputMetadata ?? {}, error: args.error, completedAt: new Date(),
          }).where(eq(schema.agentSteps.id, stepId))), undefined),
        listSteps: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("listSteps", db.select().from(schema.agentSteps).where(eq(schema.agentSteps.taskId, taskId)));
            rows.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
            return rows.map((r) => ({
              id: r.id, taskId: r.taskId, type: r.type, status: r.status, summary: r.summary,
              inputMetadata: r.inputMetadata, outputMetadata: r.outputMetadata, durationMs: r.durationMs,
              startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null, error: r.error,
            }));
          }),
        listTransitions: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("listTransitions", db.select().from(schema.taskTransitions).where(eq(schema.taskTransitions.taskId, taskId)));
            return rows.map((r) => ({ id: r.id, taskId: r.taskId, from: r.from, to: r.to, reason: r.reason, createdAt: r.createdAt.toISOString() }));
          }),
        saveHypotheses: (taskId, hyps) =>
          Effect.gen(function* () {
            const rows = yield* wrap("saveHypotheses", db.insert(schema.hypotheses).values(hyps.map((h) => ({
              taskId, title: h.title, description: h.description,
              confidence: Math.round(h.confidence * 100),
            }))).returning());
            return rows.map((r) => ({
              id: r.id, taskId: r.taskId, title: r.title, description: r.description ?? "",
              confidence: r.confidence, status: r.status, conclusion: r.conclusion,
            }));
          }),
        setHypothesisStatus: (id, status, conclusion) =>
          Effect.as(wrap("setHypothesisStatus", db.update(schema.hypotheses).set({ status, conclusion }).where(eq(schema.hypotheses.id, id))), undefined),
        listHypotheses: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("listHypotheses", db.select().from(schema.hypotheses).where(eq(schema.hypotheses.taskId, taskId)));
            return rows.map((r) => ({
              id: r.id, taskId: r.taskId, title: r.title, description: r.description ?? "",
              confidence: r.confidence, status: r.status, conclusion: r.conclusion,
            }));
          }),
        saveEvidence: (taskId, items) =>
          items.length === 0
            ? Effect.void
            : Effect.as(wrap("saveEvidence", db.insert(schema.evidence).values(items.map((it) => ({
              taskId, hypothesisId: it.hypothesisId, kind: it.kind,
              file: it.file, line: it.line, snippet: it.snippet, detail: it.detail,
            })))), undefined),
        listEvidence: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("listEvidence", db.select().from(schema.evidence).where(eq(schema.evidence.taskId, taskId)));
            return rows.map((r) => ({
              id: r.id, taskId: r.taskId, hypothesisId: r.hypothesisId, kind: r.kind,
              file: r.file, line: r.line, snippet: r.snippet ?? "", detail: r.detail ?? "",
            }));
          }),
        snapshotFile: (taskId, path, content, sha) =>
          Effect.as(wrap("snapshotFile", db.insert(schema.fileSnapshots).values({ taskId, path, content, sha })), undefined),
        savePatch: (taskId, patch) =>
          Effect.gen(function* () {
            const [row] = yield* wrap("savePatch", db.insert(schema.patches).values({ taskId, ...patch, filesChanged: [...patch.filesChanged] }).returning());
            return { id: row.id, taskId: row.taskId, description: row.description ?? "", diff: row.diff ?? "", filesChanged: row.filesChanged ?? [], additions: row.additions, deletions: row.deletions, status: row.status };
          }),
        getLatestPatch: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getLatestPatch", db.select().from(schema.patches).where(eq(schema.patches.taskId, taskId)).orderBy(desc(schema.patches.createdAt)).limit(1));
            if (rows.length === 0) return null;
            const row = rows[0];
            return { id: row.id, taskId: row.taskId, description: row.description ?? "", diff: row.diff ?? "", filesChanged: row.filesChanged ?? [], additions: row.additions, deletions: row.deletions, status: row.status };
          }),
        saveTestRun: (taskId, run) =>
          Effect.as(wrap("saveTestRun", db.insert(schema.testRuns).values({ taskId, ...run, passed: run.passed ? 1 : 0 })), undefined),
        listTestRuns: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("listTestRuns", db.select().from(schema.testRuns).where(eq(schema.testRuns.taskId, taskId)));
            return rows.map((r) => ({
              id: r.id, taskId: r.taskId, kind: r.kind ?? "test", command: r.command,
              exitCode: r.exitCode, stdout: r.stdout ?? "", stderr: r.stderr ?? "",
              durationMs: r.durationMs, passed: r.passed,
            }));
          }),
        saveReview: (taskId, review) =>
          Effect.as(wrap("saveReview", db.insert(schema.reviews).values({
            taskId, approved: review.approved ? 1 : 0, severity: review.severity,
            findings: [...review.findings], summary: review.summary,
          })), undefined),
        getLatestReview: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getLatestReview", db.select().from(schema.reviews).where(eq(schema.reviews.taskId, taskId)).orderBy(desc(schema.reviews.createdAt)).limit(1));
            if (rows.length === 0) return null;
            const r = rows[0];
            return { id: r.id, taskId: r.taskId, approved: r.approved, severity: r.severity, findings: (r.findings ?? []) as unknown[], summary: r.summary ?? "" };
          }),
        savePRProposal: (taskId, pr) =>
          Effect.gen(function* () {
            const [row] = yield* wrap("savePRProposal", db.insert(schema.pullRequests).values({ taskId, ...pr }).returning());
            return { id: row.id, taskId: row.taskId, branch: row.branch, title: row.title, body: row.body ?? "", url: row.url, number: row.number, status: row.status };
          }),
        markPRCreated: (taskId, url, number) =>
          Effect.as(wrap("markPRCreated", db.update(schema.pullRequests).set({ url, number, status: "created" }).where(eq(schema.pullRequests.taskId, taskId))), undefined),
        getPR: (taskId) =>
          Effect.gen(function* () {
            const rows = yield* wrap("getPR", db.select().from(schema.pullRequests).where(eq(schema.pullRequests.taskId, taskId)).limit(1));
            if (rows.length === 0) return null;
            const row = rows[0];
            return { id: row.id, taskId: row.taskId, branch: row.branch, title: row.title, body: row.body ?? "", url: row.url, number: row.number, status: row.status };
          }),
      };

      return api;
    }),
  );

/** Picks Postgres when DATABASE_URL is set, otherwise the ephemeral memory store. */
export const TaskStoreLive: Layer.Layer<TaskStore, never, AppConfigService> =
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const config = yield* AppConfigService;
      if (config.databaseUrl) {
        yield* Effect.logInfo("TaskStore: using PostgreSQL backend");
        return TaskStorePostgresLive;
      }
      yield* Effect.logWarning(
        "TaskStore: DATABASE_URL unset — using ephemeral in-memory store (data will not persist)",
      );
      return TaskStoreMemoryLive;
    }),
  );
