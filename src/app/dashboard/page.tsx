"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CircleAlert, GitPullRequest, ListTodo, Radar } from "lucide-react";
import { NewTaskForm } from "@/components/new-task-form";
import { CardPad, EmptyState, PageHeader, Skeleton, StatusBadge, isTerminalStatus } from "@/components/ui";
import { timeAgo } from "@/lib/format";

interface TaskRow {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
  updatedAt: string;
}

const TERMINAL_OK = new Set(["READY_FOR_PR", "PR_CREATED"]);

function Stat({ label, value, tone }: { label: string; value: string | number; tone: "emerald" | "sky" | "red" | "zinc" }) {
  const tones = {
    emerald: "text-emerald-300",
    sky: "text-sky-300",
    red: "text-red-300",
    zinc: "text-zinc-100",
  } as const;
  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3.5">
      <p className={`font-mono text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{label}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks(((j.tasks ?? []) as TaskRow[]).slice(0, 8)))
      .catch(() => setTasks([]));
  }, []);

  const list = tasks ?? [];
  const active = list.filter((t) => !isTerminalStatus(t.status) && t.status !== "FAILED");
  const ready = list.filter((t) => TERMINAL_OK.has(t.status));
  const failed = list.filter((t) => t.status === "FAILED");

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Dashboard"
        description="Point Fixora at a GitHub issue and watch it work the full engineering lifecycle."
        actions={
          <Link href="/tasks" className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/80 bg-zinc-900/70 px-3.5 py-2 text-sm text-zinc-200 transition-colors hover:border-zinc-500">
            All tasks <ArrowRight size={14} aria-hidden />
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active investigations" value={tasks === null ? "—" : active.length} tone="sky" />
        <Stat label="Ready / PR created" value={tasks === null ? "—" : ready.length} tone="emerald" />
        <Stat label="Failed runs" value={tasks === null ? "—" : failed.length} tone={failed.length > 0 ? "red" : "zinc"} />
        <Stat label="Total tasks" value={tasks === null ? "—" : list.length} tone="zinc" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_1fr]">
        <NewTaskForm />
        <CardPad className="!p-0 overflow-hidden">
          <p className="border-b border-zinc-800/80 px-5 py-3.5 font-mono text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Recent tasks
          </p>
          {tasks === null && (
            <div className="grid gap-2 p-4" aria-label="Loading tasks">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}
            </div>
          )}
          {tasks !== null && tasks.length === 0 && (
            <EmptyState icon={ListTodo} title="No tasks yet" hint="Create your first investigation — or run the 2-minute demo to watch the full pipeline on a real bug." />
          )}
          <ul className="divide-y divide-zinc-800/60">
            {(tasks ?? []).map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="group flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-800/40">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100 group-hover:text-white">
                      <span className="mr-1.5 font-mono text-zinc-500">#{t.issueNumber}</span>
                      {t.issueTitle}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                      {t.repoName} · {timeAgo(t.updatedAt)}
                    </p>
                  </div>
                  <StatusBadge status={t.status} className="shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </CardPad>
      </div>

      <div className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5 sm:grid-cols-3">
        {[
          { icon: Radar, text: "Watches the repo before touching it — ranked files, not whole-codebase dumps." },
          { icon: CircleAlert, text: "Stops for your approval before any push. Zero auto-merges, ever." },
          { icon: GitPullRequest, text: "Every PR ships with reproduction proof, test results, and a review." },
        ].map((f) => (
          <div key={f.text} className="flex items-start gap-2.5 text-sm leading-relaxed text-zinc-400">
            <f.icon size={16} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden />
            {f.text}
          </div>
        ))}
      </div>
    </div>
  );
}
