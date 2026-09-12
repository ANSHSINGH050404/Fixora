import { Schema } from "effect";

/** Structured issue analysis produced by IssueAnalyzer. */
export class IssueAnalysis extends Schema.Class<IssueAnalysis>("IssueAnalysis")({
  summary: Schema.String,
  kind: Schema.Literal("bug", "feature", "question", "chore", "security"),
  severity: Schema.Literal("low", "medium", "high", "critical"),
  keywords: Schema.Array(Schema.String),
  suspectedAreas: Schema.Array(Schema.String),
  reproductionHints: Schema.Array(Schema.String),
  questions: Schema.Array(Schema.String),
}) {}

/** Repository map produced by RepositoryMapper. */
export class RepositoryMap extends Schema.Class<RepositoryMap>("RepositoryMap")({
  framework: Schema.String,
  language: Schema.String,
  packageManager: Schema.String,
  architecture: Schema.String,
  entrypoints: Schema.Array(Schema.String),
  packages: Schema.Array(Schema.String),
  services: Schema.Array(Schema.String),
  database: Schema.String,
  testFramework: Schema.String,
  testCommand: Schema.String,
  typecheckCommand: Schema.String,
  lintCommand: Schema.String,
  importantFiles: Schema.Array(Schema.String),
}) {}

/** A single code finding from exploration. */
export class CodeFinding extends Schema.Class<CodeFinding>("CodeFinding")({
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  symbol: Schema.optional(Schema.String),
  snippet: Schema.String,
  relevance: Schema.String,
  score: Schema.Number,
}) {}

/** A candidate root-cause hypothesis. */
export class Hypothesis extends Schema.Class<Hypothesis>("Hypothesis")({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  evidence: Schema.Array(Schema.String),
  confidence: Schema.Number,
  status: Schema.Literal("proposed", "confirmed", "rejected"),
  conclusion: Schema.optional(Schema.String),
}) {}

/** Sandbox execution result. */
export class SandboxResult extends Schema.Class<SandboxResult>(
  "SandboxResult",
)({
  command: Schema.String,
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  durationMs: Schema.Number,
  timedOut: Schema.Boolean,
}) {}

/** Reproduction attempt outcome. */
export class ReproductionResult extends Schema.Class<ReproductionResult>(
  "ReproductionResult",
)({
  reproduced: Schema.Boolean,
  method: Schema.String,
  detail: Schema.String,
  supportingHypothesisId: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.String),
}) {}

/** Structured fix plan — implementation is forbidden before this exists. */
export class FixPlan extends Schema.Class<FixPlan>("FixPlan")({
  problem: Schema.String,
  rootCause: Schema.String,
  files: Schema.Array(Schema.String),
  changes: Schema.Array(Schema.String),
  regressionTest: Schema.String,
  risk: Schema.Literal("low", "medium", "high"),
  expectedBehavior: Schema.String,
}) {}

/** A file edit applied by the implementation agent. */
export class FileEdit extends Schema.Class<FileEdit>("FileEdit")({
  path: Schema.String,
  before: Schema.String,
  after: Schema.String,
}) {}

/** Test execution verdict with failure classification. */
export class TestVerdict extends Schema.Class<TestVerdict>("TestVerdict")({
  passed: Schema.Boolean,
  command: Schema.String,
  exitCode: Schema.Number,
  summary: Schema.String,
  failureClass: Schema.optional(
    Schema.Literal("patch", "pre-existing", "environment", "flaky", "unrelated"),
  ),
  output: Schema.String,
}) {}

/** Independent review verdict. */
export class ReviewFinding extends Schema.Class<ReviewFinding>(
  "ReviewFinding",
)({
  severity: Schema.Literal("low", "medium", "high", "critical"),
  category: Schema.String,
  file: Schema.optional(Schema.String),
  message: Schema.String,
  suggestion: Schema.optional(Schema.String),
}) {}

export class ReviewResult extends Schema.Class<ReviewResult>("ReviewResult")({
  approved: Schema.Boolean,
  severity: Schema.Literal("low", "medium", "high", "critical"),
  findings: Schema.Array(ReviewFinding),
  summary: Schema.String,
}) {}

/** PR proposal awaiting explicit user approval. */
export class PRProposal extends Schema.Class<PRProposal>("PRProposal")({
  branch: Schema.String,
  commitMessage: Schema.String,
  title: Schema.String,
  body: Schema.String,
  filesChanged: Schema.Array(Schema.String),
  additions: Schema.Number,
  deletions: Schema.Number,
}) {}
