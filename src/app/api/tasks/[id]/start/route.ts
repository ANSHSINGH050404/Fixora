import { NextResponse } from "next/server";
import path from "node:path";
import { Effect } from "effect";
import { runFork, runPromise } from "@/server/workflows/runtime";
import { runTask } from "@/server/workflows/run-task";
import { TaskStore } from "@/server/services/store-memory";

export const dynamic = "force-dynamic";

/** Start the autonomous investigation (background; poll GET / SSE for progress). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let token: string | undefined;
  try {
    const body = (await req.json()) as { token?: string };
    token = typeof body.token === "string" && body.token.length > 0 ? body.token : undefined;
  } catch {
    token = undefined;
  }

  try {
    const task = await runPromise(
      Effect.flatMap(TaskStore, (s) => s.getTask(id)).pipe(
        Effect.mapError((e) => new Error(e.message)),
      ),
    );
    if (task.status !== "QUEUED") {
      return NextResponse.json(
        { error: `task is ${task.status} — only QUEUED tasks can be started` },
        { status: 409 },
      );
    }
    const repo = await runPromise(
      Effect.flatMap(TaskStore, (s) => s.getRepository(task)).pipe(
        Effect.mapError((e) => new Error(e.message)),
      ),
    );
    const localPath =
      repo.owner === "local-demo" ? path.join(process.cwd(), "demo-fixture", "cache-bug") : undefined;
    runFork(runTask(id, { token, localPath }));
    return NextResponse.json({ started: true, taskId: id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
