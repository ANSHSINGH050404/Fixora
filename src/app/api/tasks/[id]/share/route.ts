import { NextResponse } from "next/server";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { isPublic } = await _req.json();
  try {
    const shareToken = isPublic ? await randomBytes(16).then((b) => b.toString("hex")) : null;
    yield db
      .update(schema.agentTasks)
      .set({ isPublic, shareToken, updatedAt: new Date() })
      .where(eq(schema.agentTasks.id, id));
    return NextResponse.json({ shareToken, isPublic, ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    yield db
      .update(schema.agentTasks)
      .set({ isPublic: 0, shareToken: null, updatedAt: new Date() })
      .where(eq(schema.agentTasks.id, id));
    return NextResponse.json({ shareToken: null, isPublic: false, ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}