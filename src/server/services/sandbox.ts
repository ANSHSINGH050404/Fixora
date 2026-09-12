import { Effect } from "effect";
import { SandboxExecutionError, SecurityError } from "../domain/errors";
import { SettingsService } from "./settings";
import { spawnCapture } from "./process";

export interface SandboxRunInput {
  readonly cwd: string;
  /** argv array — never a shell string. */
  readonly command: string[];
  readonly timeoutMs?: number;
}

export interface SandboxRunResult {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly backend: "docker" | "local";
}

/** Commands the agent is allowed to execute. No shells, no package managers besides bun. */
const ALLOWLIST = new Set(["bun", "bunx", "git"]);
const OUTPUT_LIMIT = 50_000;

/** Docker's own exit code when the daemon/runner fails (not the command). */
const DOCKER_INFRA_EXIT = 125;
const DOCKER_INFRA_SIGNALS =
  /unable to find image|pull access denied|no such image|error response from daemon|cannot connect|is the docker daemon running/i;

const scrubEnv = (env: Record<string, string | undefined>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (/TOKEN|SECRET|KEY|PASSWORD|DATABASE_URL|AUTH/i.test(k)) continue;
    out[k] = v;
  }
  out.PATH = process.env.PATH ?? "";
  return out;
};

const truncate = (s: string): string =>
  s.length > OUTPUT_LIMIT ? s.slice(0, OUTPUT_LIMIT) + `\n…[truncated ${s.length - OUTPUT_LIMIT} chars]` : s;

/**
 * Docker is usable only when the daemon responds AND the sandbox image exists
 * locally. A missing image must not masquerade as a command failure (docker
 * exits 125 for its own errors).
 */
const dockerUsable = (image: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const info = yield* spawnCapture("docker", ["info"], { timeoutMs: 10_000 });
    if (info.code !== 0) return false;
    const inspect = yield* spawnCapture("docker", ["image", "inspect", image], {
      timeoutMs: 15_000,
    });
    return inspect.code === 0;
  });

export class SandboxService extends Effect.Service<SandboxService>()(
  "SandboxService",
  {
    effect: Effect.gen(function* () {
      const settings = yield* SettingsService;

      /** Resolve hot-configurable sandbox knobs per call. */
      const knobs = settings.getEffective().pipe(
        Effect.map((c) => ({ timeoutMs: c.sandboxTimeoutMs, image: c.sandboxImage })),
        Effect.mapError(
          (e) =>
            new SandboxExecutionError({ command: "settings", stderr: e.message }),
        ),
      );

      const runLocal = (input: SandboxRunInput): Effect.Effect<SandboxRunResult, SandboxExecutionError | SecurityError> =>
        Effect.gen(function* () {
          const [bin, ...args] = input.command;
          if (!bin || !ALLOWLIST.has(bin)) {
            return yield* Effect.fail(
              new SecurityError({ message: `command not allowlisted: ${bin ?? "(empty)"}` }),
            );
          }
          const timeoutMs = input.timeoutMs ?? (yield* knobs).timeoutMs;
          const started = Date.now();
          const res = yield* spawnCapture(bin, args, {
            cwd: input.cwd,
            timeoutMs,
            env: scrubEnv(process.env),
          });
          if (res.timedOut) {
            return yield* Effect.fail(
              new SandboxExecutionError({
                command: input.command.join(" "),
                stderr: truncate(res.stderr),
                timedOut: true,
              }),
            );
          }
          return {
            command: input.command.join(" "),
            exitCode: res.code,
            stdout: truncate(res.stdout),
            stderr: truncate(res.stderr),
            durationMs: Date.now() - started,
            timedOut: false,
            backend: "local" as const,
          };
        });

      const runDocker = (input: SandboxRunInput): Effect.Effect<SandboxRunResult, SandboxExecutionError | SecurityError> =>
        Effect.gen(function* () {
          if (input.command.length === 0 || !ALLOWLIST.has(input.command[0])) {
            return yield* Effect.fail(
              new SecurityError({ message: `command not allowlisted: ${input.command[0] ?? "(empty)"}` }),
            );
          }
          const k = yield* knobs;
          const timeoutMs = input.timeoutMs ?? k.timeoutMs;
          const started = Date.now();
          const argv = [
            "run", "--rm",
            "--network", "none",
            "--memory", "512m",
            "--cpus", "1",
            "--user", "1000:1000",
            "-v", `${input.cwd}:/work:rw`,
            "-w", "/work",
            k.image,
            ...input.command,
          ];
          const res = yield* spawnCapture("docker", argv, {
            timeoutMs,
            env: { PATH: process.env.PATH ?? "" },
          });
          if (res.timedOut) {
            return yield* Effect.fail(
              new SandboxExecutionError({ command: input.command.join(" "), stderr: truncate(res.stderr), timedOut: true }),
            );
          }
          return {
            command: input.command.join(" "),
            exitCode: res.code,
            stdout: truncate(res.stdout),
            stderr: truncate(res.stderr),
            durationMs: Date.now() - started,
            timedOut: false,
            backend: "docker" as const,
          };
        });

      return {
        /**
         * Execute an allowlisted command. Prefers Docker isolation; falls
         * back to a scrubbed-env local spawn when Docker is unusable.
         * Non-zero exits are returned as data, not failures — except docker's
         * own 125 infra exit, which triggers the local fallback.
         */
        run: (input: SandboxRunInput) =>
          Effect.gen(function* () {
            const k = yield* knobs;
            if (yield* dockerUsable(k.image)) {
              const attempt = yield* Effect.either(runDocker(input));
              if (attempt._tag === "Right") {
                const res = attempt.right;
                const infraFailure =
                  res.backend === "docker" &&
                  res.exitCode === DOCKER_INFRA_EXIT &&
                  DOCKER_INFRA_SIGNALS.test(res.stderr);
                if (!infraFailure) return res;
                yield* Effect.logWarning(
                  "sandbox docker infra failure, falling back to local",
                );
              } else {
                yield* Effect.logWarning(`sandbox docker failed, falling back to local: ${String(attempt.left)}`);
              }
            }
            return yield* runLocal(input);
          }),
      };
    }),
  },
) {}
