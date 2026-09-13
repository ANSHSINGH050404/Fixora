import { NextResponse } from "next/server";
import { runPromise } from "@/server/workflows/runtime";
import { getTaskDetail } from "@/server/workflows/task-detail";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const detail = await runPromise(
      getTaskDetail(id).pipe(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (detail) => detail,
      ),
    );
    return new NextResponse(
      `id: task_updated\ndata: ${JSON.stringify({
        id: detail.task.id,
        status: detail.task.status,
        currentStage: detail.task.currentStage,
        attempt: detail.task.attempt,
        summary: detail.task.summary,
        error: detail.task.error,
        createdAt: detail.task.createdAt,
        updatedAt: detail.task.updatedAt,
      })}\n\n`,
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      },
    );
  } catch (_e) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}