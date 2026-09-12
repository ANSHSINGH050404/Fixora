import { NextResponse } from "next/server";
import { Effect, Schema } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { SettingsService } from "@/server/services/settings";

export const dynamic = "force-dynamic";

const TestLLMBody = Schema.Struct({
  baseUrl: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
});

/**
 * Live LLM connection check. Explicit values win; otherwise the effective
 * (stored override → env) configuration is used. Nothing is persisted.
 */
export async function POST(req: Request) {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = Schema.decodeUnknownEither(TestLLMBody)(body);
  if (parsed._tag === "Left") {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }
  try {
    const result = await runPromise(
      Effect.gen(function* () {
        const s = yield* SettingsService;
        const effective = yield* s.getEffective();
        const baseUrl = parsed.right.baseUrl || effective.llmBaseUrl;
        const apiKey = parsed.right.apiKey || effective.llmApiKey;
        if (!baseUrl || !apiKey) {
          return yield* Effect.fail(
            new Error("provide a base URL and API key, or save settings first"),
          );
        }
        const check = yield* s.testLLM({ baseUrl, apiKey });
        return { ok: true as const, model: effective.llmModel, modelCount: check.modelCount };
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
