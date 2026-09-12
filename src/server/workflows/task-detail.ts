import { Effect } from "effect";
import { TaskStore } from "../services/store-memory";

/** Full task detail bundle for the UI (one round trip per page load). */
export const getTaskDetail = (taskId: string) =>
  Effect.gen(function* () {
    const store = yield* TaskStore;
    const task = yield* store.getTask(taskId);
    const [repository, issue, steps, transitions, hypotheses, evidence, patch, testRuns, review, pr] =
      yield* Effect.all(
        [
          store.getRepository(task),
          store.getIssue(task),
          store.listSteps(taskId),
          store.listTransitions(taskId),
          store.listHypotheses(taskId),
          store.listEvidence(taskId),
          store.getLatestPatch(taskId),
          store.listTestRuns(taskId),
          store.getLatestReview(taskId),
          store.getPR(taskId),
        ] as const,
        { concurrency: "unbounded" },
      );
    return {
      task,
      repository,
      issue,
      steps,
      transitions,
      hypotheses,
      evidence,
      patch,
      testRuns,
      review,
      pr,
    };
  });

export type TaskDetail = Effect.Effect.Success<ReturnType<typeof getTaskDetail>>;
