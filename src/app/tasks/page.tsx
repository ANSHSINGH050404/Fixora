"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ListTodo, Plus } from "lucide-react";
import { EmptyState, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { isRunningStatus, isTerminalStatus } from "@/components/ui";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

interface TaskRow {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
  error: string | null;
  updatedAt: string;
}

type Filter = "all" | "active" | "ready" | "failed";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "ready", label: "Ready / merged" },
  { key: "failed", label: "Failed" },
];

function matches(t: TaskRow, f: Filter): boolean {
  switch (f) {
    case "active": return isRunningStatus(t.status) || t.status === "QUEUED";
    case "ready": return t.status === "READY_FOR_PR" || t.status === "PR_CREATED";
    case "failed": return t.status === "FAILED" || t.status === "CANCELLED";
    default: return true;
  }
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks((j.tasks ?? []) as TaskRow[]))
      .catch(() => setTasks([]));
  }, []);

  const visible = useMemo(() => (tasks ?? []).filter((t) => matches(t, filter)), [tasks, filter]);
  const counts = useMemo(() => ({
    all: (tasks ?? []).length,
    active: (tasks ?? []).filter((t) => matches(t, "active")).length,
    ready: (tasks ?? []).filter((t) => matches(t, "ready")).length,
    failed: (tasks ?? []).filter((t) => matches(t, "failed")).length,
  }), [tasks]);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Tasks"
        description={tasks === null ? "Loading…" : `${counts.all} total · ${counts.active} active`}
        actions={
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-300">
            <Plus size={15} aria-hidden /> New task
          </Link>
        }
      />

      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter tasks">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-sm transition-colors",
              filter === f.key ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
            )}
          >
            {f.label}
            <span className="ml-1.5 font-mono text-[11px] text-zinc-500">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {tasks === null && (
        <div className="grid gap-2" aria-label="Loading tasks">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px]" />)}
        </div>
      )}

      {tasks !== null && visible.length === 0 && (
        <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50">
          <EmptyState
            icon={ListTodo}
            title={tasks.length === 0 ? "No tasks yet" : `No ${filter} tasks`}
            hint={tasks.length === 0 ? "Create your first investigation from the dashboard." : "Try a different filter."}
            action={tasks.length === 0 ? <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-300"><Plus size={15} aria-hidden /> New task</Link> : undefined}
          />
        </div>
      )}

      <ul className="grid gap-2">
        {visible.map((t) => (
          <li key={t.id}>
            <Link href={`/tasks/${t.id}`} className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3.5 transition-colors hover:border-zinc-600 hover:bg-zinc-900">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  <span className="mr-1.5 font-mono text-zinc-500">#{t.issueNumber}</span>
                  {t.issueTitle}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                  {t.repoName} · {isTerminalStatus(t.status) ? "finished" : "updated"} {timeAgo(t.updatedAt)}
                </p>
                {t.error && <p className="mt-1 truncate text-xs text-red-300/90">{t.error}</p>}
              </div>
              <StatusBadge status={t.status} className="shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
