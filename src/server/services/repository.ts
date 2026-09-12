import { Effect } from "effect";
import { RepositoryAnalysisError, SecurityError, SettingsError } from "../domain/errors";
import { spawnCapture } from "./process";
import { SettingsService } from "./settings";

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MAX_FILE_BYTES = 500_000;

const checkSegment = (value: string, what: string) =>
  SAFE_SEGMENT.test(value) && !value.includes("..")
    ? Effect.void
    : Effect.fail(
        new SecurityError({ message: `unsafe ${what}: ${value}` }),
      );

/** Resolve a repo-relative path inside root, rejecting traversal escapes. */
export const resolveInside = (
  root: string,
  rel: string,
): Effect.Effect<string, SecurityError> =>
  Effect.gen(function* () {
    const path = yield* Effect.promise(() => import("node:path"));
    if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel) || rel.includes("\0")) {
      return yield* Effect.fail(
        new SecurityError({ message: `absolute paths not allowed: ${rel.slice(0, 100)}` }),
      );
    }
    const normalized = path.normalize(rel).replace(/^[/\\]+/, "");
    const abs = path.join(root, normalized);
    const rootNorm = path.normalize(root + path.sep);
    if (abs !== path.normalize(root) && !abs.startsWith(rootNorm)) {
      return yield* Effect.fail(
        new SecurityError({ message: `path escapes workspace: ${rel}` }),
      );
    }
    return abs;
  });

const runGit = (args: string[], cwd?: string) =>
  Effect.map(
    spawnCapture("git", args, { cwd, timeoutMs: 60_000 }),
    ({ stdout, stderr, code }) => ({ stdout, stderr, code }),
  );

const redact = (s: string): string => s.replace(/x-access-token:[^@\s]+@/g, "x-access-token:<redacted>@");

export class RepositoryService extends Effect.Service<RepositoryService>()(
  "RepositoryService",
  {
    effect: Effect.gen(function* () {
      const settings = yield* SettingsService;
      const path = yield* Effect.promise(() => import("node:path"));
      const fs = yield* Effect.promise(() => import("node:fs/promises"));

      const workspaceFor = (
        owner: string,
        name: string,
      ): Effect.Effect<string, SecurityError | SettingsError> =>
        Effect.gen(function* () {
          yield* checkSegment(owner, "owner");
          yield* checkSegment(name, "repo");
          const c = yield* settings.getEffective();
          return path.join(c.workspaceDir, owner, name);
        });

      return {
        workspaceFor,

        /** Clone (or refresh) the repository locally for inspection. */
        ensureClone: (
          owner: string,
          name: string,
          defaultBranch: string,
          token?: string,
        ): Effect.Effect<string, RepositoryAnalysisError | SecurityError | SettingsError> =>
          Effect.gen(function* () {
            const dir = yield* workspaceFor(owner, name);
            const authedUrl = token
              ? `https://x-access-token:${token}@github.com/${owner}/${name}.git`
              : `https://github.com/${owner}/${name}.git`;
            yield* Effect.promise(() => fs.mkdir(path.dirname(dir), { recursive: true })).pipe(
              Effect.mapError((e) => new RepositoryAnalysisError({ message: String(e) })),
            );
            const exists = yield* Effect.promise(() =>
              fs.stat(path.join(dir, ".git")).then(() => true).catch(() => false),
            );
            if (!exists) {
              const res = yield* runGit(["clone", "--depth", "50", "--branch", defaultBranch, authedUrl, dir]);
              if (res.code !== 0) {
                return yield* Effect.fail(
                  new RepositoryAnalysisError({ message: `clone failed: ${redact(res.stderr).slice(0, 500)}` }),
                );
              }
            } else {
              const res = yield* runGit(["fetch", "origin", defaultBranch, "--depth", "50"], dir);
              if (res.code !== 0) {
                return yield* Effect.fail(
                  new RepositoryAnalysisError({ message: `fetch failed: ${redact(res.stderr).slice(0, 500)}`, path: dir }),
                );
              }
              const reset = yield* runGit(["reset", "--hard", `origin/${defaultBranch}`], dir);
              if (reset.code !== 0) {
                return yield* Effect.fail(
                  new RepositoryAnalysisError({ message: `reset failed: ${redact(reset.stderr).slice(0, 500)}`, path: dir }),
                );
              }
            }
            return dir;
          }),

        /** List files (git-tracked) under the checkout, capped for LLM budgets. */
        listFiles: (root: string, limit = 2000) =>
          Effect.gen(function* () {
            const res = yield* runGit(["ls-files"], root);
            if (res.code !== 0) {
              return yield* Effect.fail(
                new RepositoryAnalysisError({ message: `ls-files failed: ${res.stderr.slice(0, 300)}`, path: root }),
              );
            }
            return res.stdout.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, limit);
          }),

        readFile: (root: string, rel: string) =>
          Effect.gen(function* () {
            const abs = yield* resolveInside(root, rel);
            const stat = yield* Effect.promise(() => fs.stat(abs).catch(() => null)).pipe(
              Effect.mapError((e) => new RepositoryAnalysisError({ message: String(e), path: rel })),
            );
            if (!stat || !stat.isFile()) {
              return yield* Effect.fail(new RepositoryAnalysisError({ message: `not a file: ${rel}`, path: rel }));
            }
            if (stat.size > MAX_FILE_BYTES) {
              return yield* Effect.fail(
                new RepositoryAnalysisError({ message: `file too large (${stat.size} bytes): ${rel}`, path: rel }),
              );
            }
            const content = yield* Effect.promise(() => fs.readFile(abs, "utf-8")).pipe(
              Effect.mapError((e) => new RepositoryAnalysisError({ message: String(e), path: rel })),
            );
            return { path: rel, content };
          }),

        /** Ripgrep-style search via git grep (no extra binary required). */
        search: (root: string, pattern: string | string[], limit = 50) =>
          Effect.gen(function* () {
            const patterns = (Array.isArray(pattern) ? pattern : [pattern])
              .map((p) => p.trim())
              .filter((p) => p.length > 0 && p.length <= 200 && !/[\n\r\0]/.test(p));
            if (patterns.length === 0) {
              return yield* Effect.fail(
                new SecurityError({ message: "invalid search pattern" }),
              );
            }
            // Fixed-string, one -e per keyword: OR semantics without regex pitfalls.
            const args = ["grep", "-n", "-I", "--no-color", "-F"];
            for (const p of patterns.slice(0, 8)) args.push("-e", p);
            args.push("--", ".");
            const res = yield* runGit(args, root);
            // git grep exits 1 when nothing matches — not an error.
            if (res.code !== 0 && res.code !== 1) {
              return yield* Effect.fail(
                new RepositoryAnalysisError({ message: `search failed: ${res.stderr.slice(0, 300)}`, path: root }),
              );
            }
            return res.stdout
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .slice(0, limit)
              .map((line) => {
                const idx = line.indexOf(":");
                const rest = line.slice(idx + 1);
                const idx2 = rest.indexOf(":");
                return {
                  file: line.slice(0, idx),
                  line: Number(rest.slice(0, idx2)) || 0,
                  text: rest.slice(idx2 + 1).slice(0, 300),
                };
              });
          }),

        recentCommits: (root: string, file?: string, limit = 10) =>
          Effect.gen(function* () {
            const args = ["log", `--max-count=${Math.min(limit, 20)}`, "--pretty=format:%h%x00%s%x00%an%x00%ad", "--date=short", "--"];
            if (file) args.push(file);
            const res = yield* runGit(args, root);
            if (res.code !== 0) {
              return yield* Effect.fail(
                new RepositoryAnalysisError({ message: `git log failed: ${res.stderr.slice(0, 300)}`, path: root }),
              );
            }
            return res.stdout
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean)
              .map((l) => {
                const [sha, message, author, date] = l.split("\x00");
                return { sha, message, author, date };
              });
          }),

        /** Current uncommitted diff (the agent's patch in progress). */
        currentDiff: (root: string) =>
          Effect.gen(function* () {
            const res = yield* runGit(["diff", "--", "."], root);
            if (res.code !== 0) {
              return yield* Effect.fail(
                new RepositoryAnalysisError({ message: `git diff failed: ${res.stderr.slice(0, 300)}`, path: root }),
              );
            }
            return res.stdout.slice(0, MAX_FILE_BYTES);
          }),
      };
    }),
  },
) {}
