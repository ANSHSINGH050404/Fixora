import { NextResponse } from "next/server";
import { Effect } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { getTaskDetail } from "@/server/workflows/task-detail";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const detail = await runPromise(
      getTaskDetail(id).pipe(
        Effect.mapError((e) => new Error(e.message)),
      ),
    );
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "not found" }, { status: 404 });
  }
}
