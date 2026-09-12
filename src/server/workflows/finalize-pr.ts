import { Effect } from "effect";
import { AgentStageError, GitHubError } from "../domain/errors";
import { GitHubService } from "../services/github";
import { logStep } from "../services/logger";
import { spawnCapture } from "../services/process";
import { RepositoryService } from "../services/repository";
import { TaskStore } from "../services/store-memory";
import type { WorkflowServices } from "./run-task";

/**
 * Approval-gated PR creation. Called ONLY from the explicit approval API
 * route after the user clicks "Create PR". Never from the autonomous loop.
 *
 * Commits the agent's working-tree patch onto a new branch, pushes it, and
 * opens the pull request through the GitHub API.
 */
export const finalizePR = (
  taskId: string,
  token: string,
): Effect.Effect<{ url: string; number: number }, AgentStageError, WorkflowServices> =>
  Effect.gen(function* () {
    const store = yield* TaskStore;
    const github = yield* GitHubService;
    const repoSvc = yield* RepositoryService;

    const task = yield* store.getTask(taskId).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: "PR_CREATED", message: e.message })),
    );
    if (task.status !== "READY_FOR_PR") {
      return yield* Effect.fail(
        new AgentStageError({ stage: "PR_CREATED", message: `task is ${task.status}, not READY_FOR_PR — approval requires a reviewed proposal` }),
      );
    }
    const repository = yield* store.getRepository(task).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: "PR_CREATED", message: e.message })),
    );
    const pr = yield* store.getPR(taskId).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: "PR_CREATED", message: e.message })),
    );
    if (!pr) {
      return yield* Effect.fail(new AgentStageError({ stage: "PR_CREATED", message: "no PR proposal found" }));
    }
    const patch = yield* store.getLatestPatch(taskId).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: "PR_CREATED", message: e.message })),
    );
    if (!patch || patch.filesChanged.length === 0) {
      return yield* Effect.fail(new AgentStageError({ stage: "PR_CREATED", message: "no patch to publish" }));
    }
    if (repository.owner === "local-demo") {
      return yield* Effect.fail(
        new AgentStageError({ stage: "PR_CREATED", message: "demo tasks have no GitHub remote — inspect the diff locally" }),
      );
    }

    const root = yield* repoSvc.workspaceFor(repository.owner, repository.name).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: "PR_CREATED", message: e.message })),
    );
    const step = yield* store.beginStep(taskId, "PR_CREATED", { branch: pr.branch }).pipe(
      Effect.mapError((e) => new AgentStageError({ stage: "PR_CREATED", message: e.message })),
    );
    yield* logStep(taskId, "PR_CREATED", "started");

    const result = yield* Effect.gen(function* () {
      const git = (args: string[]) =>
        Effect.flatMap(
          spawnCapture("git", args, { cwd: root, timeoutMs: 60_000 }),
          (r) =>
            r.code !== 0
              ? Effect.fail(new GitHubError({ message: r.stderr.slice(0, 500) || `git exited ${r.code}`, endpoint: "git" }))
              : Effect.succeed(r.stdout.trim()),
        );

      yield* git(["checkout", "-B", pr.branch]);
      yield* git(["add", "--", ...patch.filesChanged]);
      const status = yield* git(["status", "--porcelain"]);
      if (!status) {
        return yield* Effect.fail(new GitHubError({ message: "working tree clean — nothing to publish", endpoint: "git" }));
      }
      yield* git(["-c", "user.email=maintainer-os@local", "-c", "user.name=MaintainerOS", "commit", "-m", "fix from MaintainerOS PR proposal"]);
      // Push via token-injected remote (token never logged).
      const push = yield* Effect.flatMap(
        spawnCapture(
          "git",
          ["push", `https://x-access-token:${token}@github.com/${repository.owner}/${repository.name}.git`, `${pr.branch}:${pr.branch}`, "--force-with-lease"],
          { cwd: root, timeoutMs: 120_000 },
        ),
        (r) =>
          r.code !== 0
            ? Effect.fail(
                new GitHubError({
                  message: r.stderr.replace(/x-access-token:[^@\s]+@/g, "x-access-token:<redacted>@").slice(0, 500),
                  endpoint: "git push",
                }),
              )
            : Effect.void,
      ).pipe(Effect.either);
      if (push._tag === "Left") return yield* Effect.fail(push.left);

      const created = yield* github.createPullRequest(
        repository.owner,
        repository.name,
        { title: pr.title, body: pr.body, head: pr.branch, base: task.branch ?? repository.defaultBranch },
        token,
      );
      yield* store.markPRCreated(taskId, created.url, created.number).pipe(
        Effect.mapError((e) => new GitHubError({ message: e.message, endpoint: "store" })),
      );
      yield* store.setStatus(taskId, "PR_CREATED", `PR #${created.number} opened`).pipe(
        Effect.mapError((e) => new GitHubError({ message: e.message, endpoint: "store" })),
      );
      return created;
    }).pipe(Effect.either);

    if (result._tag === "Left") {
      const message = result.left.message;
      yield* store.endStep(step.id, { status: "failed", summary: `PR creation failed: ${message}`, error: message }).pipe(
        Effect.orElseSucceed(() => undefined),
      );
      return yield* Effect.fail(new AgentStageError({ stage: "PR_CREATED", message }));
    }
    yield* store.endStep(step.id, {
      status: "success",
      summary: `PR #${result.right.number} created: ${result.right.url}`,
      outputMetadata: result.right,
    }).pipe(Effect.orElseSucceed(() => undefined));
    yield* logStep(taskId, "PR_CREATED", "success");
    return result.right;
  });
