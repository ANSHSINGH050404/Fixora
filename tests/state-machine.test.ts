import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { InvalidTransitionError } from "../src/server/domain/errors";
import { transition } from "../src/server/domain/state-machine";

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff);

describe("task state machine", () => {
  test("allows the forward pipeline", async () => {
    const flow: Array<[string, string]> = [
      ["QUEUED", "ANALYZING_ISSUE"],
      ["ANALYZING_ISSUE", "MAPPING_REPOSITORY"],
      ["MAPPING_REPOSITORY", "EXPLORING_CODE"],
      ["EXPLORING_CODE", "GENERATING_HYPOTHESES"],
      ["GENERATING_HYPOTHESES", "REPRODUCING"],
      ["REPRODUCING", "ANALYZING_ROOT_CAUSE"],
      ["ANALYZING_ROOT_CAUSE", "PLANNING_FIX"],
      ["PLANNING_FIX", "IMPLEMENTING"],
      ["IMPLEMENTING", "RUNNING_TESTS"],
      ["RUNNING_TESTS", "REVIEWING"],
      ["REVIEWING", "READY_FOR_PR"],
      ["READY_FOR_PR", "PR_CREATED"],
    ];
    for (const [from, to] of flow) {
      await run(transition(from, to));
    }
  });

  test("allows self-repair back-edges", async () => {
    await run(transition("RUNNING_TESTS", "IMPLEMENTING"));
    await run(transition("REVIEWING", "IMPLEMENTING"));
  });

  test("allows FAILED/CANCELLED from any live state", async () => {
    await run(transition("EXPLORING_CODE", "FAILED"));
    await run(transition("IMPLEMENTING", "CANCELLED"));
    await run(transition("QUEUED", "FAILED"));
  });

  test("rejects skips and backward jumps", async () => {
    const err = await run(Effect.flip(transition("QUEUED", "IMPLEMENTING")));
    expect(err).toBeInstanceOf(InvalidTransitionError);
    const back = await run(Effect.flip(transition("REVIEWING", "EXPLORING_CODE")));
    expect(back).toBeInstanceOf(InvalidTransitionError);
  });

  test("terminal states have no outgoing edges", async () => {
    for (const t of ["PR_CREATED", "FAILED", "CANCELLED"]) {
      const err = await run(Effect.flip(transition(t, "QUEUED")));
      expect(err).toBeInstanceOf(InvalidTransitionError);
    }
  });
});
