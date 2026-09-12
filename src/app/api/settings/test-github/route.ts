import { NextResponse } from "next/server";
import { Effect, Schema } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { SettingsService } from "@/server/services/settings";

export const dynamic = "force-dynamic";

const TestGitHubBody = Schema.Struct({
  token: Schema.optional(Schema.String),
});

/**
 * Live GitHub token check. An explicit token wins; otherwise the effective
 * (stored override → env) token is used. Nothing is persisted.
 */
export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Schema.decodeUnknownEither(TestGitHubBody)(body);
  if (parsed._tag === "Left") {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  try {
    const result = await runPromise(
      Effect.gen(function* () {
        const s = yield* SettingsService;
        const effective = yield* s.getEffective();
        const token = parsed.right.token || effective.githubToken;
        if (!token) {
          return yield* Effect.fail(new Error("provide a token, or save one in settings first"));
        }
        const check = yield* s.testGitHub(token);
        return { ok: true as const, login: check.login };
      }).pipe(
        Effect.mapError((e) => (e instanceof Error ? e : new Error(String(e)))),
      ),
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false as const, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
