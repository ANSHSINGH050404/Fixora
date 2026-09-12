import { spawn, type ChildProcess } from "node:child_process";
import { Effect } from "effect";

export interface SpawnResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
  readonly timedOut: boolean;
}

const DEFAULT_MAX_BYTES = 1_000_000;

/**
 * Portable child-process execution (works on Node and Bun runtimes).
 * Never uses a shell: argv-only invocation, so no shell injection surface.
 * Always resolves — transport problems are data, never defects.
 */
export const spawnCapture = (
  command: string,
  args: readonly string[],
  opts: {
    readonly cwd?: string;
    readonly timeoutMs?: number;
    readonly env?: Record<string, string>;
    readonly maxBytes?: number;
  } = {},
): Effect.Effect<SpawnResult, never> =>
  Effect.promise(
    () =>
      new Promise<SpawnResult>((resolve) => {
        const max = opts.maxBytes ?? DEFAULT_MAX_BYTES;
        let stdout = "";
        let stderr = "";
        let settled = false;
        const done = (r: SpawnResult): void => {
          if (!settled) {
            settled = true;
            resolve(r);
          }
        };
        let proc: ChildProcess;
        try {
          proc = spawn(command, [...args], {
            cwd: opts.cwd,
            env: { ...process.env, ...opts.env },
            shell: false,
            windowsHide: true,
          });
        } catch {
          done({ stdout: "", stderr: `spawn failed: ${command}`, code: 127, timedOut: false });
          return;
        }
        const child: ChildProcess = proc;
        const timer =
          opts.timeoutMs !== undefined
            ? setTimeout(() => {
                try {
                  child.kill("SIGKILL");
                } catch {
                  /* already exited */
                }
                done({ stdout, stderr, code: -1, timedOut: true });
              }, opts.timeoutMs)
            : undefined;
        child.stdout?.on("data", (d: unknown) => {
          if (stdout.length < max) stdout += String(d).slice(0, max - stdout.length);
        });
        child.stderr?.on("data", (d: unknown) => {
          if (stderr.length < max) stderr += String(d).slice(0, max - stderr.length);
        });
        child.on("error", () => {
          if (timer) clearTimeout(timer);
          done({ stdout, stderr, code: 127, timedOut: false });
        });
        child.on("close", (code) => {
          if (timer) clearTimeout(timer);
          done({ stdout, stderr, code: code ?? 0, timedOut: false });
        });
      }),
  );
