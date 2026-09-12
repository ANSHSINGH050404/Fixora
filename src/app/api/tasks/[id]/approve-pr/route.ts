import { NextResponse } from "next/server";
import { finalizePR } from "@/server/workflows/finalize-pr";
import { runPromise } from "@/server/workflows/runtime";

export const dynamic = "force-dynamic";

/**
 * Explicit human approval gate. Pushes the reviewed patch and opens the PR.
 * Requires a token with push rights; never called by the autonomous loop.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let token: string | undefined;
  try {
    const body = (await req.json()) as { token?: string };
    token = typeof body.token === "string" && body.token.length > 0 ? body.token : undefined;
  } catch {
    token = undefined;
  }
  if (!token) {
    return NextResponse.json(
      { error: "a GitHub token with push rights is required to create the PR" },
      { status: 400 },
    );
  }
  try {
    const result = await runPromise(finalizePR(id, token));
    return NextResponse.json({ url: result.url, number: result.number });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = /not READY_FOR_PR|no PR proposal|no patch|demo tasks/i.test(message) ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
