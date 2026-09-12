import { Effect } from "effect";
import { RepositoryMap } from "../domain/schemas";
import { RepositoryService } from "./repository";

const CANDIDATE_DIRS = ["src", "app", "apps", "packages", "lib", "server", "tests", "test", "docs", "components", "routes", "api"] as const;
const MARKER_FILES = ["package.json", "bun.lock", "bun.lockb", "tsconfig.json", "next.config.js", "next.config.mjs", "next.config.ts", "drizzle.config.ts", "prisma/schema.prisma", ".env.example"] as const;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

const parsePackageJson = (raw: string): PackageJson => {
  try {
    return JSON.parse(raw) as PackageJson;
  } catch {
    return {};
  }
};

const detectFramework = (pkg: PackageJson, files: string[]): string => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return "Next.js";
  if (deps.express) return "Express";
  if (deps.hono) return "Hono";
  if (deps.elysia) return "Elysia";
  if (files.some((f) => f.endsWith(".py"))) return "Python";
  return "Bun/TypeScript";
};

const detectTestFramework = (pkg: PackageJson): { framework: string; command: string } => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};
  if (scripts.test) return { framework: scripts.test.includes("vitest") ? "Vitest" : scripts.test.includes("jest") ? "Jest" : "Bun test", command: "bun run test" };
  if (deps.vitest) return { framework: "Vitest", command: "bunx vitest run" };
  if (deps.jest) return { framework: "Jest", command: "bunx jest" };
  if (deps["bun:test"] || deps.bun) return { framework: "Bun test", command: "bun test" };
  return { framework: "Bun test", command: "bun test" };
};

const detectDatabase = (pkg: PackageJson): string => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps["drizzle-orm"]) return "PostgreSQL (Drizzle)";
  if (deps["@prisma/client"]) return "Prisma";
  if (deps.mongoose || deps.mongodb) return "MongoDB";
  if (deps.redis || deps.ioredis) return "Redis";
  if (deps.postgres || deps.pg) return "PostgreSQL";
  if (deps.sqlite3 || deps["bun:sqlite"]) return "SQLite";
  return "none detected";
};

const detectServices = (pkg: PackageJson): string[] => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const services: string[] = [];
  if (deps.next) services.push("nextjs");
  if (deps["drizzle-orm"] || deps.postgres || deps.pg) services.push("postgres");
  if (deps.redis || deps.ioredis) services.push("redis");
  if (deps.bullmq || deps.bull) services.push("queue");
  if (deps["next-auth"] || deps.lucia || deps["@clerk/nextjs"]) services.push("auth");
  if (deps.openai || deps.ai) services.push("llm");
  return services;
};

/**
 * Score files against issue keywords so the LLM only sees relevant code.
 * Deterministic — no tokens spent on ranking.
 */
export const scoreRelevance = (file: string, keywords: readonly string[]): number => {
  const lower = file.toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (!k) continue;
    if (lower.includes(k)) score += 3;
    const parts = lower.split(/[/_.-]/);
    if (parts.includes(k)) score += 2;
  }
  if (/\.(test|spec|repro)\./.test(lower)) score += 1;
  if (/(index|main|server|worker|client|route|handler)/.test(lower)) score += 1;
  if (/node_modules|dist|\.next|coverage/.test(lower)) score -= 100;
  return score;
};

/** Parse `.env.example` keys only — never secret values. */
const parseEnvKeys = (raw: string): string[] =>
  raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => l.split("=")[0].trim())
    .filter(Boolean)
    .slice(0, 50);

export const mapRepository = (
  root: string,
  issueKeywords: readonly string[],
): Effect.Effect<
  { map: RepositoryMap; importantFiles: string[]; envKeys: string[] },
  never,
  RepositoryService
> =>
  Effect.gen(function* () {
    const repo = yield* RepositoryService;
    const files = yield* repo.listFiles(root).pipe(Effect.orElseSucceed(() => [] as string[]));

    const readIfPresent = (rel: string) =>
      files.includes(rel)
        ? repo.readFile(root, rel).pipe(Effect.map((f) => f.content), Effect.orElseSucceed(() => ""))
        : Effect.succeed("");

    const [pkgRaw, envExample, nextConfigPresent] = yield* Effect.all([
      readIfPresent("package.json"),
      readIfPresent(".env.example"),
      Effect.succeed(files.some((f) => f.startsWith("next.config"))),
    ]);

    const pkg = parsePackageJson(pkgRaw);
    const test = detectTestFramework(pkg);
    const scripts = pkg.scripts ?? {};

    const entrypoints = files.filter((f) =>
      /^(src\/)?(index|main|server|app|cli)\.(ts|tsx|js|mjs)$/.test(f) ||
      f === "src/app/page.tsx" ||
      f === "app/page.tsx",
    ).slice(0, 10);
    const packages = [...new Set(files.map((f) => f.split("/")[0]).filter((d) => (CANDIDATE_DIRS as readonly string[]).includes(d)))];
    const apiRoutes = files.filter((f) => /route\.(ts|js)$/.test(f) || f.includes("pages/api")).slice(0, 20);

    const importantFiles = [
      ...MARKER_FILES.filter((m) => files.includes(m)),
      ...entrypoints,
      ...apiRoutes.slice(0, 5),
    ];

    const ranked = files
      .map((f) => ({ file: f, score: scoreRelevance(f, issueKeywords) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
      .map((r) => r.file);

    const merged = [...new Set([...importantFiles, ...ranked])].slice(0, 40);

    return {
      map: new RepositoryMap({
        framework: nextConfigPresent && pkgRaw.includes("next") ? "Next.js" : detectFramework(pkg, files),
        language: "TypeScript",
        packageManager: files.includes("bun.lock") || files.includes("bun.lockb") ? "Bun" : "unknown",
        architecture: files.some((f) => f.startsWith("packages/")) || files.some((f) => f.startsWith("apps/")) ? "monorepo" : "single-package",
        entrypoints,
        packages,
        services: detectServices(pkg),
        database: detectDatabase(pkg),
        testFramework: test.framework,
        testCommand: test.command,
        typecheckCommand: scripts.typecheck ? "bun run typecheck" : "bunx tsc --noEmit",
        lintCommand: scripts.lint ? "bun run lint" : "bunx eslint .",
        importantFiles: merged,
      }),
      importantFiles: merged,
      envKeys: envExample ? parseEnvKeys(envExample) : [],
    };
  });
