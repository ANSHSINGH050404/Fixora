import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Users of MaintainerOS (owner of tasks / GitHub token vault metadata). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** GitHub repositories under investigation. */
export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Cached GitHub issues that tasks work on. */
export const issues = pgTable("issues", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  state: text("state").notNull().default("open"),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Autonomous engineering tasks. `status` is the persisted agent state machine
 * state; every transition is appended to `agent_steps` and `task_transitions`.
 */
export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id),
  issueId: uuid("issue_id")
    .notNull()
    .references(() => issues.id),
  branch: text("branch"),
  status: text("status").notNull().default("QUEUED"),
  currentStage: text("current_stage"),
  attempt: integer("attempt").notNull().default(0),
  // Token never stored in plaintext-adjacent columns; kept only in memory per run.
  hasUserToken: integer("has_user_token").notNull().default(0),
  summary: text("summary"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Explicit transition log for the task state machine. */
export const taskTransitions = pgTable("task_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  from: text("from").notNull(),
  to: text("to").notNull(),
  reason: text("reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** One row per agent stage execution (with retry attempts as separate rows). */
export const agentSteps = pgTable("agent_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  summary: text("summary").notNull().default(""),
  inputMetadata: jsonb("input_metadata").$type<unknown>().notNull().default({}),
  outputMetadata: jsonb("output_metadata")
    .$type<unknown>()
    .notNull()
    .default({}),
  durationMs: integer("duration_ms"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

/** Candidate root causes with confidence scores. */
export const hypotheses = pgTable("hypotheses", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  confidence: integer("confidence").notNull().default(50),
  status: text("status").notNull().default("proposed"),
  conclusion: text("conclusion"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Individual pieces of evidence linked to hypotheses. */
export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  hypothesisId: uuid("hypothesis_id").references(() => hypotheses.id),
  kind: text("kind").notNull().default("OBSERVATION"),
  file: text("file"),
  line: integer("line"),
  snippet: text("snippet").notNull().default(""),
  detail: text("detail").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Snapshots of files read during investigation (for audit + diffing). */
export const fileSnapshots = pgTable("file_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  sha: text("sha"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Candidate patches produced by the implementation agent. */
export const patches = pgTable("patches", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  description: text("description").notNull().default(""),
  diff: text("diff").notNull().default(""),
  filesChanged: jsonb("files_changed").$type<string[]>().notNull().default([]),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  status: text("status").notNull().default("proposed"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Sandbox test/typecheck/lint executions. */
export const testRuns = pgTable("test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  kind: text("kind").notNull().default("test"),
  command: text("command").notNull(),
  exitCode: integer("exit_code"),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  passed: integer("passed").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Independent code-review verdicts. */
export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  approved: integer("approved").notNull().default(0),
  severity: text("severity").notNull().default("low"),
  findings: jsonb("findings").$type<unknown[]>().notNull().default([]),
  summary: text("summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** PR proposals (and created PRs) awaiting/explicitly approved by the user. */
export const pullRequests = pgTable("pull_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id),
  branch: text("branch").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  url: text("url"),
  number: integer("number"),
  status: text("status").notNull().default("proposed"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AgentTaskRow = typeof agentTasks.$inferSelect;
export type AgentStepRow = typeof agentSteps.$inferSelect;

/**
 * Runtime settings overrides managed from the Settings UI.
 * Secret values are AES-GCM encrypted; all other values are plaintext.
 */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
