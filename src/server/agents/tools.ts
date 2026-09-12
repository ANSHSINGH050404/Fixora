import { Effect, Schema } from "effect";
import { ToolError } from "../domain/errors";

export interface AgentToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly execute: (input: unknown) => Effect.Effect<unknown, ToolError>;
}

export const defineTool = <I, O>(def: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Schema<I>;
  readonly parameters: Record<string, unknown>;
  readonly execute: (input: I) => Effect.Effect<O, ToolError>;
}): AgentToolDef => ({
  name: def.name,
  description: def.description,
  parameters: def.parameters,
  execute: (raw: unknown) =>
    Effect.flatMap(
      Schema.decodeUnknown(def.inputSchema)(raw).pipe(
        Effect.mapError((e) => new ToolError({ message: `invalid input for ${def.name}: ${String(e)}`, tool: def.name })),
      ),
      (input) =>
        def.execute(input).pipe(
          Effect.mapError((e) =>
            e instanceof ToolError ? e : new ToolError({ message: String(e), tool: def.name }),
          ),
        ),
    ),
});

export class ToolRegistry {
  private readonly tools = new Map<string, AgentToolDef>();

  register(tool: AgentToolDef): void {
    this.tools.set(tool.name, tool);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  describe(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  call(name: string, input: unknown): Effect.Effect<unknown, ToolError> {
    const tool = this.tools.get(name);
    if (!tool) {
      return Effect.fail(new ToolError({ message: `unknown tool: ${name}`, tool: name }));
    }
    return tool.execute(input);
  }
}

/** Shared context threaded through every agent stage. */
export interface AgentContext {
  readonly taskId: string;
  /** Per-task user token (never persisted, never sent to the LLM). */
  readonly token: string | undefined;
  readonly owner: string;
  readonly name: string;
  readonly branch: string;
  readonly root: string;
}
