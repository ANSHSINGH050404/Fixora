import { Effect, Schedule } from "effect";
import { LLMError } from "../domain/errors";
import { SettingsService } from "./settings";

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool input. */
  readonly parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

export interface GenerateResult {
  readonly text: string;
  readonly toolCalls: ToolCallRequest[];
  readonly model: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

/** Strip fenced code blocks so models returning ```json are still parseable. */
export const extractJson = (text: string): string => {
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text);
  if (fence?.[1]) return fence[1].trim();
  const start = text.search(/[{[]/);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text.trim();
};

export class LLMService extends Effect.Service<LLMService>()("LLMService", {
  effect: Effect.gen(function* () {
    const settings = yield* SettingsService;

    /** Resolve connection details per call so Settings UI changes apply without restart. */
    const liveEffective = settings.getEffective().pipe(
      Effect.mapError((e) => new LLMError({ message: e.message, retryable: false })),
    );
    const resolve = Effect.map(liveEffective, (c) => ({
      enabled: Boolean(c.llmBaseUrl && c.llmApiKey),
      baseUrl: (c.llmBaseUrl ?? "").replace(/\/+$/, ""),
      model: c.llmModel,
      apiKey: c.llmApiKey,
    }));

    interface ChatConn {
      readonly baseUrl: string;
      readonly model: string;
      readonly apiKey: string | undefined;
    }

    type ChatOpts = {
      readonly tools?: ToolDefinition[];
      readonly maxTokens?: number;
      readonly temperature?: number;
    };

    const postChat = (
      conn: ChatConn,
      messages: ChatMessage[],
      opts: ChatOpts = {},
    ): Effect.Effect<GenerateResult, LLMError> =>
      Effect.tryPromise({
        try: async (): Promise<GenerateResult> => {
          const res = await fetch(`${conn.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${conn.apiKey}`,
            },
            body: JSON.stringify({
              model: conn.model,
              messages,
              temperature: opts.temperature ?? 0.2,
              max_tokens: opts.maxTokens ?? 4096,
              ...(opts.tools && opts.tools.length > 0
                ? {
                    tools: opts.tools.map((t) => ({
                      type: "function",
                      function: { name: t.name, description: t.description, parameters: t.parameters },
                    })),
                    tool_choice: "auto",
                  }
                : {}),
            }),
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            const err = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`) as Error & {
              status: number;
            };
            err.status = res.status;
            throw err;
          }
          const json = (await res.json()) as {
            choices: Array<{
              message: {
                content: string | null;
                tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
              };
            }>;
            usage?: { prompt_tokens: number; completion_tokens: number };
            model?: string;
          };
          const msg = json.choices[0]?.message;
          return {
            text: msg?.content ?? "",
            toolCalls: (msg?.tool_calls ?? []).map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments,
            })),
            model: json.model ?? conn.model,
            promptTokens: json.usage?.prompt_tokens,
            completionTokens: json.usage?.completion_tokens,
          };
        },
        catch: (e) =>
          new LLMError({
            message: e instanceof Error ? e.message : String(e),
            retryable: true,
          }),
      }).pipe(
        Effect.retry({
          schedule: Schedule.exponential("1 second").pipe(Schedule.intersect(Schedule.recurs(2))),
          while: (e) => e.retryable !== false,
        }),
        Effect.timeoutFail({
          duration: "120 seconds",
          onTimeout: () => new LLMError({ message: "LLM request timed out", retryable: true }),
        }),
      );

    const callChat = (
      messages: ChatMessage[],
      opts: ChatOpts = {},
    ): Effect.Effect<GenerateResult, LLMError> =>
      Effect.flatMap(resolve, (conn) =>
        conn.enabled
          ? postChat(conn, messages, opts)
          : Effect.fail(
              new LLMError({
                message: "LLM not configured (set it in Settings or via LLM_BASE_URL + LLM_API_KEY)",
                retryable: false,
              }),
            ),
      );

    return {
      /** Whether an LLM backend is configured. Stages must degrade gracefully. */
      isEnabled: Effect.map(resolve, (r) => r.enabled).pipe(
        Effect.catchAll((e) =>
          Effect.zipRight(
            Effect.logWarning(`settings unavailable, treating LLM as disabled: ${e.message}`),
            Effect.succeed(false),
          ),
        ),
      ),
      modelName: Effect.map(resolve, (r) => r.model).pipe(
        Effect.orElseSucceed(() => "unconfigured"),
      ),

      generate: (messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }) =>
        callChat(messages, opts),

      stream: (messages: ChatMessage[], onToken: (token: string) => void) =>
        Effect.gen(function* () {
          // Non-SSE fallback: single generation, then emit in chunks so
          // callers can always treat output as a stream.
          const result = yield* callChat(messages);
          const chunkSize = 120;
          for (let i = 0; i < result.text.length; i += chunkSize) {
            onToken(result.text.slice(i, i + chunkSize));
            yield* Effect.yieldNow();
          }
          return result;
        }),

      /** Generate and parse a JSON object; repairs fenced output automatically. */
      structured: <T>(messages: ChatMessage[], parse: (json: unknown) => T) =>
        Effect.gen(function* () {
          const result = yield* callChat(messages);
          const parsed: unknown = yield* Effect.try({
            try: () => JSON.parse(extractJson(result.text)) as unknown,
            catch: () =>
              new LLMError({
                message: `LLM returned non-JSON output: ${result.text.slice(0, 300)}`,
                retryable: false,
              }),
          });
          return yield* Effect.try({
            try: () => parse(parsed),
            catch: (e) =>
              new LLMError({
                message: `LLM output failed validation: ${e instanceof Error ? e.message : String(e)}`,
                retryable: false,
              }),
          });
        }),

      toolCall: (messages: ChatMessage[], tools: ToolDefinition[]) =>
        callChat(messages, { tools }),
    };
  }),
}) {}
