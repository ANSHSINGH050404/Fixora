import { Effect, Schedule } from "effect";
import { Octokit } from "octokit";
import { GitHubError } from "../domain/errors";
import { SettingsService } from "./settings";

export interface GitHubRepoInfo {
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly description: string;
  readonly primaryLanguage: string;
  readonly stars: number;
}

export interface GitHubIssueComment {
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface GitHubIssueData {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: string;
  readonly labels: string[];
  readonly comments: GitHubIssueComment[];
  readonly createdAt: string;
}

export interface GitHubTreeEntry {
  readonly path: string;
  readonly type: string;
  readonly sha: string;
  readonly size?: number;
}

export interface GitHubCodeMatch {
  readonly path: string;
  readonly sha: string;
  readonly snippet: string;
}

const MAX_BODY = 200_000;

const retryPolicy = Schedule.intersect(
  Schedule.exponential("500 millis"),
  Schedule.recurs(3),
);

const shouldRetry = (e: unknown): boolean =>
  typeof e === "object" &&
  e !== null &&
  "status" in e &&
  typeof (e as { status: unknown }).status === "number" &&
  ([429, 500, 502, 503, 504] as number[]).includes(
    (e as { status: number }).status,
  );

/** Parse `https://github.com/owner/repo` (or owner/repo shorthand) strictly. */
export const parseRepositoryUrl = (
  raw: string,
): Effect.Effect<{ owner: string; name: string }, GitHubError> => {
  const trimmed = raw.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const m =
    /github\.com\/([^/]+)\/([^/]+)/i.exec(trimmed) ??
    /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (!m) {
    return Effect.fail(
      new GitHubError({ message: `not a valid GitHub repository: ${raw}` }),
    );
  }
  const [, owner, name] = m;
  if (!owner || !name) {
    return Effect.fail(
      new GitHubError({ message: `not a valid GitHub repository: ${raw}` }),
    );
  }
  return Effect.succeed({ owner, name });
};

export class GitHubService extends Effect.Service<GitHubService>()(
  "GitHubService",
  {
    effect: Effect.gen(function* () {
      const settings = yield* SettingsService;

      const clientFor = (fallback: string | undefined, token?: string): Octokit =>
        new Octokit(token ?? fallback ? { auth: token ?? fallback } : {});

      const wrap = <A>(
        endpoint: string,
        run: (client: Octokit) => Promise<A>,
        token?: string,
      ): Effect.Effect<A, GitHubError> =>
        Effect.flatMap(
          settings.getEffective().pipe(
            Effect.mapError((e) => new GitHubError({ message: e.message, endpoint })),
          ),
          (c) =>
            Effect.tryPromise({
              try: () => run(clientFor(c.githubToken, token)),
              catch: (e) =>
                new GitHubError({
                  message: e instanceof Error ? e.message : String(e),
                  status:
                    typeof e === "object" && e !== null && "status" in e
                      ? Number((e as { status: unknown }).status)
                      : undefined,
                  endpoint,
                }),
            }),
        ).pipe(
          Effect.retry({ schedule: retryPolicy, while: shouldRetry }),
          Effect.timeoutFail({
            duration: "30 seconds",
            onTimeout: () =>
              new GitHubError({ message: `timed out: ${endpoint}`, endpoint }),
          }),
        );

      return {
        parseUrl: parseRepositoryUrl,

        getRepository: (
          owner: string,
          repo: string,
          token?: string,
        ): Effect.Effect<GitHubRepoInfo, GitHubError> =>
          Effect.map(
            wrap("getRepository", (c) => c.rest.repos.get({ owner, repo }), token),
            (r) => ({
              owner,
              name: repo,
              defaultBranch: r.data.default_branch,
              description: r.data.description ?? "",
              primaryLanguage: r.data.language ?? "unknown",
              stars: r.data.stargazers_count ?? 0,
            }),
          ),

        getIssue: (
          owner: string,
          repo: string,
          issueNumber: number,
          token?: string,
        ): Effect.Effect<GitHubIssueData, GitHubError> =>
          Effect.gen(function* () {
            const issue = yield* wrap(
              "getIssue",
              (c) => c.rest.issues.get({ owner, repo, issue_number: issueNumber }),
              token,
            );
            const comments = yield* wrap(
              "getIssueComments",
              (c) =>
                c.rest.issues.listComments({
                  owner,
                  repo,
                  issue_number: issueNumber,
                  per_page: 50,
                }),
              token,
            );
            return {
              number: issue.data.number,
              title: issue.data.title,
              body: (issue.data.body ?? "").slice(0, MAX_BODY),
              state: issue.data.state,
              labels: issue.data.labels.map((l) =>
                typeof l === "string" ? l : (l.name ?? ""),
              ),
              comments: comments.data.map((cm) => ({
                author: cm.user?.login ?? "unknown",
                body: (cm.body ?? "").slice(0, 20_000),
                createdAt: cm.created_at,
              })),
              createdAt: issue.data.created_at,
            } satisfies GitHubIssueData;
          }),

        listBranches: (owner: string, repo: string, token?: string) =>
          Effect.map(
            wrap("listBranches", (c) => c.rest.repos.listBranches({ owner, repo, per_page: 50 }), token),
            (r) => r.data.map((b) => b.name),
          ),

        getTree: (owner: string, repo: string, branch: string, token?: string) =>
          Effect.map(
            wrap(
              "getTree",
              (c) => c.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" }),
              token,
            ),
            (r): GitHubTreeEntry[] =>
              (r.data.tree ?? [])
                .filter((e) => e.type === "blob" && e.path)
                .map((e) => ({ path: e.path as string, type: "blob", sha: e.sha as string, size: e.size })),
          ),

        getFile: (owner: string, repo: string, path: string, ref: string, token?: string) =>
          Effect.gen(function* () {
            const clean = path.replace(/^\/+/, "");
            const res = yield* wrap(
              "getFile",
              (c) => c.rest.repos.getContent({ owner, repo, path: clean, ref }),
              token,
            );
            const data = res.data;
            if (Array.isArray(data) || !("content" in data)) {
              return yield* Effect.fail(
                new GitHubError({ message: `not a file: ${path}`, endpoint: "getFile" }),
              );
            }
            if (data.encoding !== "base64") {
              return yield* Effect.fail(
                new GitHubError({ message: `unsupported encoding for ${path}`, endpoint: "getFile" }),
              );
            }
            const content = Buffer.from(data.content, "base64").toString("utf-8");
            return { path: clean, content: content.slice(0, MAX_BODY), sha: data.sha };
          }),

        searchCode: (owner: string, repo: string, query: string, token?: string) =>
          Effect.map(
            wrap(
              "searchCode",
              (c) =>
                c.rest.search.code({
                  q: `${query} repo:${owner}/${repo}`,
                  per_page: 20,
                }),
              token,
            ),
            (r): GitHubCodeMatch[] =>
              r.data.items.map((it) => ({
                path: it.path,
                sha: it.sha,
                snippet: "",
              })),
          ),

        getCommitHistory: (owner: string, repo: string, path: string, token?: string) =>
          Effect.map(
            wrap(
              "getCommitHistory",
              (c) => c.rest.repos.listCommits({ owner, repo, path, per_page: 10 }),
              token,
            ),
            (r) =>
              r.data.map((cm) => ({
                sha: cm.sha.slice(0, 8),
                message: cm.commit.message.split("\n")[0],
                author: cm.commit.author?.name ?? "unknown",
                date: cm.commit.author?.date ?? "",
              })),
          ),

        createBranch: (owner: string, repo: string, branch: string, fromSha: string, token?: string) =>
          Effect.as(
            wrap(
              "createBranch",
              (c) => c.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: fromSha }),
              token,
            ),
            branch,
          ),

        getRefSha: (owner: string, repo: string, branch: string, token?: string) =>
          Effect.map(
            wrap("getRefSha", (c) => c.rest.git.getRef({ owner, repo, ref: `heads/${branch}` }), token),
            (r) => r.data.object.sha as string,
          ),

        createPullRequest: (
          owner: string,
          repo: string,
          args: { title: string; body: string; head: string; base: string },
          token?: string,
        ) =>
          Effect.map(
            wrap("createPullRequest", (c) => c.rest.pulls.create({ owner, repo, ...args }), token),
            (r) => ({ url: r.data.html_url, number: r.data.number }),
          ),

        addComment: (owner: string, repo: string, issueNumber: number, body: string, token?: string) =>
          Effect.as(
            wrap(
              "addComment",
              (c) => c.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body }),
              token,
            ),
            undefined,
          ),

        getPullRequestDiff: (owner: string, repo: string, prNumber: number, token?: string) =>
          Effect.gen(function* () {
            const c = yield* settings.getEffective().pipe(
              Effect.mapError((e) => new GitHubError({ message: e.message, endpoint: "getPullRequestDiff" })),
            );
            const client = clientFor(c.githubToken, token);
            const res = yield* Effect.tryPromise({
              try: async () => {
                const { data } = await client.rest.pulls.get({
                  owner,
                  repo,
                  pull_number: prNumber,
                  mediaType: { format: "diff" },
                });
                return data as unknown as string;
              },
              catch: (e) =>
                new GitHubError({
                  message: e instanceof Error ? e.message : String(e),
                  endpoint: "getPullRequestDiff",
                }),
            });
            return (typeof res === "string" ? res : String(res)).slice(0, MAX_BODY);
          }),
      };
    }),
  },
) {}
