import { NextResponse } from "next/server";
import { Effect } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { SettingsService } from "@/server/services/settings";
import { spawnCapture } from "@/server/services/process";

export const dynamic = "force-dynamic";

// Mirrors the sandbox default image (see SandboxService). Docker isolation is
// reported only when the daemon responds AND the image exists locally.
const SANDBOX_IMAGE = "maintainer-os-sandbox:latest";

/**
 * Environment capability report for the Settings page. Never returns secrets —
 * LLM/token fields report effective configured-state (stored override → env).
 */
export async function GET() {
  try {
    const status = await runPromise(
      Effect.gen(function* () {
        const s = yield* SettingsService;
        const effective = yield* s.getEffective();
        const info = yield* spawnCapture("docker", ["info"], { timeoutMs: 10_000 });
        let sandbox: "docker" | "local" = "local";
        if (info.code === 0) {
          const inspect = yield* spawnCapture("docker", ["image", "inspect", SANDBOX_IMAGE], {
            timeoutMs: 15_000,
          });
          sandbox = inspect.code === 0 ? "docker" : "local";
        }
        return {
          database: process.env.DATABASE_URL
            ? "postgres"
            : "memory (ephemeral — set DATABASE_URL)",
          llm: Boolean(effective.llmBaseUrl && effective.llmApiKey),
          llmModel: effective.llmModel,
          githubToken: Boolean(effective.githubToken),
          sandbox,
          workspace: effective.workspaceDir,
        };
      }),
    );
    return NextResponse.json(status);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
