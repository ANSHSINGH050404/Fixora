import { Effect } from "effect";
import { InvalidTransitionError } from "./errors";

/**
 * Explicit agent task state machine.
 *
 * Terminal states: PR_CREATED, FAILED, CANCELLED.
 * Every transition is persisted to `task_transitions` by the store layer.
 */
export const TaskStatus = {
  QUEUED: "QUEUED",
  ANALYZING_ISSUE: "ANALYZING_ISSUE",
  MAPPING_REPOSITORY: "MAPPING_REPOSITORY",
  EXPLORING_CODE: "EXPLORING_CODE",
  GENERATING_HYPOTHESES: "GENERATING_HYPOTHESES",
  REPRODUCING: "REPRODUCING",
  ANALYZING_ROOT_CAUSE: "ANALYZING_ROOT_CAUSE",
  PLANNING_FIX: "PLANNING_FIX",
  IMPLEMENTING: "IMPLEMENTING",
  RUNNING_TESTS: "RUNNING_TESTS",
  REVIEWING: "REVIEWING",
  READY_FOR_PR: "READY_FOR_PR",
  PR_CREATED: "PR_CREATED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

const TERMINAL: ReadonlySet<string> = new Set(["PR_CREATED", "FAILED", "CANCELLED"]);

/** Forward-only pipeline order (plus failure/cancel edges from anywhere). */
const ORDER: ReadonlyArray<string> = [
  "QUEUED",
  "ANALYZING_ISSUE",
  "MAPPING_REPOSITORY",
  "EXPLORING_CODE",
  "GENERATING_HYPOTHESES",
  "REPRODUCING",
  "ANALYZING_ROOT_CAUSE",
  "PLANNING_FIX",
  "IMPLEMENTING",
  "RUNNING_TESTS",
  "REVIEWING",
  "READY_FOR_PR",
  "PR_CREATED",
];

export const isTerminal = (status: string): boolean => TERMINAL.has(status);

/**
 * Validate a transition. Rules:
 * - terminal states have no outgoing edges
 * - FAILED / CANCELLED reachable from any non-terminal state
 * - otherwise exactly one step forward, or a self-repair step back to
 *   IMPLEMENTING from RUNNING_TESTS / REVIEWING
 */
export const transition = (
  from: string,
  to: string,
): Effect.Effect<void, InvalidTransitionError> => {
  if (TERMINAL.has(from)) {
    return Effect.fail(new InvalidTransitionError({ from, to }));
  }
  if (to === "FAILED" || to === "CANCELLED") {
    return Effect.void;
  }
  const fromIdx = ORDER.indexOf(from);
  const toIdx = ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) {
    return Effect.fail(new InvalidTransitionError({ from, to }));
  }
  if (toIdx === fromIdx + 1) return Effect.void;
  // Self-repair loop: tests/review can send the task back to implementation.
  if (
    (from === "RUNNING_TESTS" || from === "REVIEWING") &&
    to === "IMPLEMENTING"
  ) {
    return Effect.void;
  }
  return Effect.fail(new InvalidTransitionError({ from, to }));
};

export const STAGE_FOR_STATUS: Record<string, string> = {
  ANALYZING_ISSUE: "ISSUE_ANALYSIS",
  MAPPING_REPOSITORY: "REPOSITORY_MAPPING",
  EXPLORING_CODE: "CODE_EXPLORATION",
  GENERATING_HYPOTHESES: "HYPOTHESIS_GENERATION",
  REPRODUCING: "BUG_REPRODUCTION",
  ANALYZING_ROOT_CAUSE: "ROOT_CAUSE_ANALYSIS",
  PLANNING_FIX: "FIX_PLANNING",
  IMPLEMENTING: "IMPLEMENTATION",
  RUNNING_TESTS: "TEST_EXECUTION",
  REVIEWING: "CODE_REVIEW",
  READY_FOR_PR: "PR_PROPOSAL",
  PR_CREATED: "PR_CREATED",
};
