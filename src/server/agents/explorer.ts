import { Effect } from "effect";
import { CodeFinding, type IssueAnalysis } from "../domain/schemas";
import { toolCall } from "./tool-wiring";
import type { ToolRegistry } from "./tools";

export interface ExplorationDeps {
  readonly tools: ToolRegistry;
}

/**
 * CodeExplorer — iterative, budget-bounded exploration through agent tools:
 * keywords → repo_search → repo_read_file → findings.
 * Every step is an OBSERVATION recorded as evidence by the caller.
 */
export const exploreCode = (args: {
  tools: ToolRegistry;
  analysis: IssueAnalysis;
  importantFiles: string[];
  maxIterations?: number;
}): Effect.Effect<CodeFinding[], never> =>
  Effect.gen(function* () {
    const { tools, analysis, importantFiles } = args;
    const maxIterations = args.maxIterations ?? 3;
    const findings: CodeFinding[] = [];
    const seen = new Set<string>();
    const keywords = analysis.keywords.slice(0, 8);

    const read = (file: string) =>
      toolCall.readFile(tools, file).pipe(
        Effect.map((f) => f.content),
        Effect.orElseSucceed(() => null),
      );

    // Round 0: always read the highest-signal files (package.json + top ranked).
    for (const file of importantFiles.slice(0, 6)) {
      const content = yield* read(file);
      if (content === null) continue;
      const key = `read:${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(
        new CodeFinding({
          file,
          snippet: content.slice(0, 600),
          relevance: "ranked relevant by repository mapper",
          score: 0.6,
        }),
      );
    }

    // Rounds 1..N: one search per keyword batch, read the best new files.
    for (let round = 0; round < maxIterations; round++) {
      const batch = keywords.slice(round * 3, round * 3 + 3);
      if (batch.length === 0) break;
      const hits = yield* toolCall.search(tools, batch).pipe(
        Effect.orElseSucceed(() => [] as Array<{ file: string; line: number; text: string }>),
      );
      // Prefer source files over docs/config, with per-file caps for diversity
      // so one chatty file cannot crowd out the rest of the codebase.
      const perFile = new Map<string, number>();
      const ranked = hits
        .filter((h) => /\.(ts|tsx|js|jsx|mjs|py|go|rs)$/.test(h.file))
        .filter((h) => !seen.has(`hit:${h.file}:${h.line}`))
        .filter((h) => {
          const n = perFile.get(h.file) ?? 0;
          if (n >= 2) return false;
          perFile.set(h.file, n + 1);
          return true;
        })
        .slice(0, 8);
      for (const hit of ranked) {
        seen.add(`hit:${hit.file}:${hit.line}`);
        const content = yield* read(hit.file);
        if (content === null) continue;
        const lines = content.split("\n");
        const start = Math.max(0, hit.line - 12);
        const window = lines.slice(start, hit.line + 12).join("\n").slice(0, 1200);
        findings.push(
          new CodeFinding({
            file: hit.file,
            line: hit.line,
            snippet: window,
            relevance: `matches issue keyword(s): ${batch.filter((k) => hit.text.toLowerCase().includes(k.toLowerCase())).join(", ") || batch[0]}`,
            score: 0.5 + 0.1 * (maxIterations - round),
          }),
        );
      }
      if (findings.length >= 12) break;
    }

    return findings
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
  });

/** Pull recent commit history for the most relevant files. */
export const inspectHistory = (args: {
  tools: ToolRegistry;
  files: string[];
}): Effect.Effect<Array<{ file: string; commits: Array<{ sha: string; message: string; author: string; date: string }> }>, never> =>
  Effect.gen(function* () {
    const out: Array<{ file: string; commits: Array<{ sha: string; message: string; author: string; date: string }> }> = [];
    for (const file of args.files.slice(0, 5)) {
      const commits = yield* toolCall.history(args.tools, file, 5).pipe(
        Effect.map((cs) => [...cs] as Array<{ sha: string; message: string; author: string; date: string }>),
        Effect.orElseSucceed(() => [] as Array<{ sha: string; message: string; author: string; date: string }>),
      );
      out.push({ file, commits });
    }
    return out;
  });
