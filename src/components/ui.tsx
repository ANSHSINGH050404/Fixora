import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export function GhostButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-zinc-800 bg-zinc-900/60 p-5", className)}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500",
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
        "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500",
        className,
      )}
      {...props}
    />
  );
}

const STATUS_STYLES: Record<string, string> = {
  QUEUED: "bg-zinc-700 text-zinc-200",
  ANALYZING_ISSUE: "bg-blue-600 text-white",
  MAPPING_REPOSITORY: "bg-blue-600 text-white",
  EXPLORING_CODE: "bg-blue-600 text-white",
  GENERATING_HYPOTHESES: "bg-violet-600 text-white",
  REPRODUCING: "bg-amber-600 text-white",
  ANALYZING_ROOT_CAUSE: "bg-violet-600 text-white",
  PLANNING_FIX: "bg-cyan-700 text-white",
  IMPLEMENTING: "bg-cyan-600 text-white",
  RUNNING_TESTS: "bg-amber-600 text-white",
  REVIEWING: "bg-fuchsia-700 text-white",
  READY_FOR_PR: "bg-emerald-600 text-white",
  PR_CREATED: "bg-emerald-500 text-zinc-950",
  FAILED: "bg-red-600 text-white",
  CANCELLED: "bg-zinc-700 text-zinc-300",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold tracking-wide",
        STATUS_STYLES[status] ?? "bg-zinc-700 text-zinc-200",
        className,
      )}
    >
      {status}
    </span>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-zinc-400">
      {children}
    </h2>
  );
}
