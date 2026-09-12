import { NextResponse } from "next/server";
import { Effect } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { SettingsService } from "@/server/services/settings";
import { isSettingsKey } from "@/server/domain/settings";

export const dynamic = "force-dynamic";

/** Revert one key to its env var / built-in default. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!isSettingsKey(key)) {
    return NextResponse.json({ error: `unknown settings key: ${key}` }, { status: 400 });
  }
  try {
    const settings = await runPromise(
      Effect.gen(function* () {
        const s = yield* SettingsService;
        yield* s.clear(key);
        return yield* s.describe();
      }),
    );
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
