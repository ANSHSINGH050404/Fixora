import { NextResponse } from "next/server";
import { Effect, Schema } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { GitHubService, parseRepositoryUrl } from "@/server/services/github";
import { TaskStore } from "@/server/services/store-memory";

export const dynamic = "force-dynamic";

const CreateTaskBody = Schema.Struct({
  repositoryUrl: Schema.optional(Schema.String),
  issueNumber: Schema.optional(Schema.Number),
  issueUrl: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  token: Schema.optional(Schema.String),
  demo: Schema.optional(Schema.Boolean),
});

/** Extract an issue number from `#123`, `/issues/123`, or a bare number. */
const parseIssueRef = (issueUrl?: string, issueNumber?: number): number | null => {
  if (typeof issueNumber === "number" && Number.isInteger(issueNumber) && issueNumber > 0) {
    return issueNumber;
  }
  if (issueUrl) {
    const m = /(?:issues\/|#)(\d+)/.exec(issueUrl.trim());
    if (m) return Number(m[1]);
    const bare = /^\d+$/.exec(issueUrl.trim());
    if (bare) return Number(bare[0]);
  }
  return null;
};

export async function GET() {
  try {
    const tasks = await runPromise(
      Effect.gen(function* () {
        const store = yield* TaskStore;
        const list = yield* store.listTasks(50);
        return yield* Effect.all(
          list.map((t) =>
            Effect.gen(function* () {
              const issue = yield* store.getIssue(t).pipe(Effect.orElseSucceed(() => null));
              const repo = yield* store.getRepository(t).pipe(Effect.orElseSucceed(() => null));
              return {
                id: t.id,
                status: t.status,
                branch: t.branch,
                attempt: t.attempt,
                error: t.error,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                issueNumber: issue?.number ?? null,
                issueTitle: issue?.title ?? "unknown issue",
                repoName: repo ? `${repo.owner}/${repo.name}` : "unknown",
              };
            }),
          ),
          { concurrency: "unbounded" },
        );
      }),
    );
    return NextResponse.json({ tasks });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.decodeUnknownEither(CreateTaskBody)(body);
  if (parsed._tag === "Left") {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  const input = parsed.right;

  // --- Demo mode: local buggy fixture, no GitHub required -----------------
  if (input.demo) {
    try {
      const task = await runPromise(
        Effect.gen(function* () {
          const store = yield* TaskStore;
          return yield* store.createTask({
            repositoryUrl: "local-demo/cache-bug",
            owner: "local-demo",
            name: "cache-bug",
            defaultBranch: "main",
            issueNumber: 1,
            issueTitle: "Requests occasionally fail after the cache reconnects",
            issueBody:
              "After a cache drop + reconnect, requests that used to hit the cache now fail. " +
              "The retry helper and request layer in src/request.ts are involved. Cache get throws 'cache unavailable'.",
            issueState: "open",
            issueLabels: ["bug"],
            hasUserToken: false,
          });
        }),
      );
      return NextResponse.json({ task }, { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // --- GitHub mode ----------------------------------------------------------
  if (!input.repositoryUrl) {
    return NextResponse.json({ error: "repositoryUrl is required" }, { status: 400 });
  }
  const issueNumber = parseIssueRef(input.issueUrl, input.issueNumber);
  if (!issueNumber) {
    return NextResponse.json({ error: "issueNumber or issueUrl (…/issues/123) is required" }, { status: 400 });
  }

  try {
    const task = await runPromise(
      Effect.gen(function* () {
        const github = yield* GitHubService;
        const store = yield* TaskStore;
        const { owner, name } = yield* parseRepositoryUrl(input.repositoryUrl as string);
        const [info, issue] = yield* Effect.all(
          [
            github.getRepository(owner, name, input.token),
            github.getIssue(owner, name, issueNumber, input.token),
          ],
          { concurrency: "unbounded" },
        );
        return yield* store.createTask({
          repositoryUrl: input.repositoryUrl as string,
          owner,
          name,
          defaultBranch: info.defaultBranch,
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body,
          issueState: issue.state,
          issueLabels: issue.labels,
          branch: input.branch,
          hasUserToken: Boolean(input.token),
        });
      }),
    );
    return NextResponse.json({ task }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not a valid GitHub repository|issueNumber|required/i.test(message) ? 400 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
