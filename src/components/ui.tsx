import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------- buttons --------------------------------- */

type ButtonVariant = "primary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-400 text-zinc-950 shadow-[0_0_0_1px_rgb(52_211_153/0.4),0_8px_24px_-8px_rgb(52_211_153/0.5)] hover:bg-emerald-300 active:scale-[0.98]",
  ghost:
    "border border-zinc-700/80 bg-zinc-900/70 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]",
  danger:
    "border border-red-800/70 bg-red-950/60 text-red-200 hover:border-red-600 hover:bg-red-900/60 active:scale-[0.98]",
  subtle: "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 active:scale-[0.98]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, className, disabled, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Back-compat alias used across existing pages. */
export function GhostButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button variant="ghost" className={className} {...props} />;
}

/* ----------------------------------- cards ---------------------------------- */

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-800/90 bg-zinc-900/50 shadow-[0_1px_0_0_rgb(255_255_255/0.04)_inset] backdrop-blur-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardPad({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn("p-5", className)} {...props} />;
}

/* ----------------------------------- inputs --------------------------------- */

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export function Input({ error = false, className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors",
        error
          ? "border-red-700 focus:border-red-500"
          : "border-zinc-700/80 focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/15",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none transition-colors focus:border-emerald-500/70 focus:ring-2 focus:ring-emerald-500/15",
        className,
      )}
      {...props}
    />
  );
}

export function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm text-zinc-300">
      <span className="flex items-center justify-between gap-2 font-medium">{label}{hint}</span>
      {children}
    </label>
  );
}

/* ------------------------------- status system ------------------------------ */

export const TERMINAL_STATUSES = ["READY_FOR_PR", "PR_CREATED", "FAILED", "CANCELLED"];
export const ACTIVE_STATUSES = ["ANALYZING_ISSUE", "MAPPING_REPOSITORY", "EXPLORING_CODE", "GENERATING_HYPOTHESES", "REPRODUCING", "ANALYZING_ROOT_CAUSE", "PLANNING_FIX", "IMPLEMENTING", "RUNNING_TESTS", "REVIEWING"];

export const isTerminalStatus = (s: string): boolean => TERMINAL_STATUSES.includes(s);
export const isRunningStatus = (s: string): boolean => ACTIVE_STATUSES.includes(s);

const STATUS_TINT: Record<string, string> = {
  QUEUED: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/25",
  ANALYZING_ISSUE: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  MAPPING_REPOSITORY: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  EXPLORING_CODE: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  GENERATING_HYPOTHESES: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  REPRODUCING: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  ANALYZING_ROOT_CAUSE: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  PLANNING_FIX: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
  IMPLEMENTING: "bg-cyan-500/10 text-cyan-300 ring-cyan-500/30",
  RUNNING_TESTS: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  REVIEWING: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/30",
  READY_FOR_PR: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/40",
  PR_CREATED: "bg-emerald-400 text-zinc-950",
  FAILED: "bg-red-500/10 text-red-300 ring-red-500/40",
  CANCELLED: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/25",
};

const STATUS_DOT: Record<string, string> = {
  QUEUED: "bg-zinc-500",
  FAILED: "bg-red-400",
  CANCELLED: "bg-zinc-500",
  READY_FOR_PR: "bg-emerald-400",
  PR_CREATED: "bg-zinc-950",
};

export function prettyStatus(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export function StatusBadge({ status, pulse, className }: { status: string; pulse?: boolean; className?: string }) {
  const running = pulse ?? isRunningStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wide ring-1 ring-inset",
        STATUS_TINT[status] ?? "bg-zinc-500/10 text-zinc-300 ring-zinc-500/25",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status] ?? "bg-current", running && "animate-pulse-dot")} aria-hidden />
      {status}
    </span>
  );
}

/* --------------------------------- headings --------------------------------- */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-400">{children}</h2>
      {right}
    </div>
  );
}

/* ------------------------------ feedback blocks ----------------------------- */

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "error"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2.5 text-sm",
        tone === "error" && "border-red-800/60 bg-red-950/40 text-red-200",
        tone === "success" && "border-emerald-800/60 bg-emerald-950/40 text-emerald-200",
        tone === "info" && "border-zinc-700/80 bg-zinc-900/80 text-zinc-200",
      )}
    >
      {children}
    </p>
  );
}

export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-500">
        <Icon size={20} aria-hidden />
      </span>
      <p className="text-sm font-medium text-zinc-200">{title}</p>
      {hint && <p className="max-w-sm text-sm text-zinc-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} />;
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("animate-spin", className)} aria-hidden />;
}

/* --------------------------------- misc bits -------------------------------- */

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value > 1 ? value : value * 100)));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-zinc-800", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 11-stage pipeline stepper. `currentIndex` is the active step; -1 hides progress. */
export const PIPELINE_STAGES = [
  { key: "ISSUE_ANALYSIS", short: "Analyze" },
  { key: "REPOSITORY_MAPPING", short: "Map" },
  { key: "CODE_EXPLORATION", short: "Explore" },
  { key: "HYPOTHESIS_GENERATION", short: "Hypothesize" },
  { key: "BUG_REPRODUCTION", short: "Reproduce" },
  { key: "ROOT_CAUSE_ANALYSIS", short: "Root cause" },
  { key: "FIX_PLANNING", short: "Plan" },
  { key: "IMPLEMENTATION", short: "Implement" },
  { key: "TEST_EXECUTION", short: "Test" },
  { key: "CODE_REVIEW", short: "Review" },
  { key: "PR_PROPOSAL", short: "Propose" },
] as const;

export function StageStepper({ currentIndex, failed = false }: { currentIndex: number; failed?: boolean }) {
  return (
    <ol className="flex items-center gap-1 overflow-x-auto py-1" aria-label="Pipeline progress">
      {PIPELINE_STAGES.map((s, i) => {
        const done = currentIndex >= 0 && i < currentIndex;
        const current = i === currentIndex;
        const failedHere = failed && current;
        return (
          <li key={s.key} className="flex shrink-0 items-center gap-1">
            <span
              title={s.key}
              className={cn(
                "rounded-full px-2 py-0.5 font-mono text-[10px] font-medium tracking-wide ring-1 ring-inset transition-colors",
                done && "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
                current && !failedHere && "bg-sky-500/15 text-sky-200 ring-sky-500/40",
                failedHere && "bg-red-500/15 text-red-300 ring-red-500/40",
                !done && !current && "bg-zinc-800/40 text-zinc-600 ring-zinc-700/40",
              )}
            >
              {s.short}
            </span>
            {i < PIPELINE_STAGES.length - 1 && (
              <span className={cn("h-px w-2", i < currentIndex ? "bg-emerald-500/50" : "bg-zinc-800")} aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Map a task status + completed step types to a stepper index. */
export function stageIndexFor(status: string, completedStepTypes: string[]): number {
  if (status === "FAILED" || status === "CANCELLED") {
    const last = PIPELINE_STAGES.findLastIndex((s) => completedStepTypes.includes(s.key));
    return last >= 0 ? last : 0;
  }
  if (status === "READY_FOR_PR" || status === "PR_CREATED") return PIPELINE_STAGES.length;
  const idx = PIPELINE_STAGES.findIndex((s) => !completedStepTypes.includes(s.key));
  return idx === -1 ? PIPELINE_STAGES.length : idx;
}
