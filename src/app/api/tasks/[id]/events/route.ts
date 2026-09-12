import { Effect } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { getTaskDetail } from "@/server/workflows/task-detail";
import { isTerminal } from "@/server/domain/state-machine";

export const dynamic = "force-dynamic";

/** Server-sent live timeline: polls the store and pushes snapshots on change. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const encoder = new TextEncoder();
  let lastHash = "";
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15_000);
      const deadline = Date.now() + 10 * 60_000;

      try {
        while (!closed && Date.now() < deadline) {
          const detail = await runPromise(
            getTaskDetail(id).pipe(Effect.mapError((e) => new Error(e.message))),
          ).catch(() => null);
          if (!detail) {
            send({ error: "task not found" });
            break;
          }
          const snapshot = {
            status: detail.task.status,
            stage: detail.task.currentStage,
            attempt: detail.task.attempt,
            error: detail.task.error,
            steps: detail.steps.map((s) => ({
              id: s.id,
              type: s.type,
              status: s.status,
              summary: s.summary,
              startedAt: s.startedAt,
              completedAt: s.completedAt,
              durationMs: s.durationMs,
              error: s.error,
            })),
            transitions: detail.transitions,
            hypotheses: detail.hypotheses,
            evidenceCount: detail.evidence.length,
            testRuns: detail.testRuns.map((t) => ({
              id: t.id,
              kind: t.kind,
              command: t.command,
              exitCode: t.exitCode,
              passed: t.passed,
              durationMs: t.durationMs,
            })),
            review: detail.review,
            pr: detail.pr,
            patch: detail.patch
              ? {
                  filesChanged: detail.patch.filesChanged,
                  additions: detail.patch.additions,
                  deletions: detail.patch.deletions,
                }
              : null,
          };
          const hash = JSON.stringify(snapshot).length + ":" + snapshot.steps.length + ":" + snapshot.status;
          if (hash !== lastHash) {
            lastHash = hash;
            send(snapshot);
          }
          if (isTerminal(detail.task.status)) {
            await new Promise((r) => setTimeout(r, 500));
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } finally {
        clearInterval(heartbeat);
        closed = true;
        controller.close();
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
