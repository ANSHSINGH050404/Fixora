import { NextResponse } from "next/server";
import { Effect, Schema } from "effect";
import { runPromise } from "@/server/workflows/runtime";
import { SettingsService } from "@/server/services/settings";
import {
  EDITABLE_KEYS,
  SettingsPutBody,
  type SettingsKey,
} from "@/server/domain/settings";

export const dynamic = "force-dynamic";

/** Redacted settings view: values for non-secrets, set/unset + source for all. */
export async function GET() {
  try {
    const settings = await runPromise(
      Effect.flatMap(SettingsService, (s) => s.describe()),
    );
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Persist validated overrides. Secrets are encrypted; values never echoed back. */
export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.decodeUnknownEither(SettingsPutBody)(body);
  if (parsed._tag === "Left") {
    return NextResponse.json({ error: "invalid settings: check field formats and ranges" }, { status: 400 });
  }
  const values: Partial<Record<SettingsKey, string | number>> = {};
  for (const key of EDITABLE_KEYS) {
    const v: unknown = (parsed.right as Record<string, unknown>)[key];
    if (v !== undefined) {
      (values as Record<string, string | number>)[key] = v as string | number;
    }
  }
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: "no settings provided" }, { status: 400 });
  }
  try {
    const settings = await runPromise(
      Effect.gen(function* () {
        const s = yield* SettingsService;
        yield* s.setMany(values);
        return yield* s.describe();
      }),
    );
    return NextResponse.json({ settings });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Fail-closed crypto errors surface as 500 without leaking values.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
