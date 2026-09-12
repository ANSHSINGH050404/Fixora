"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, FolderGit2 } from "lucide-react";
import { CardPad, EmptyState, PageHeader, Skeleton } from "@/components/ui";

interface TaskRow {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
}

export default function RepositoriesPage() {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks((j.tasks ?? []) as TaskRow[]))
      .catch(() => setTasks([]));
  }, []);

  const repos = new Map<string, { tasks: number; open: number }>();
  for (const t of tasks ?? []) {
    const r = repos.get(t.repoName) ?? { tasks: 0, open: 0 };
    r.tasks += 1;
    if (!["PR_CREATED", "FAILED", "CANCELLED"].includes(t.status)) r.open += 1;
    repos.set(t.repoName, r);
  }

  return (
    <div className="grid gap-5">
      <PageHeader title="Repositories" description="Every codebase Fixora has investigated, grouped with its tasks." />

      {tasks === null && (
        <div className="grid gap-2" aria-label="Loading repositories">
          {[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      )}

      {tasks !== null && repos.size === 0 && (
        <CardPad>
          <EmptyState icon={FolderGit2} title="No repositories yet" hint="Investigated repos appear here once you create your first task." />
        </CardPad>
      )}

      {[...repos.entries()].map(([name, info]) => (
        <CardPad key={name} className="transition-colors hover:border-zinc-700">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-sm font-semibold text-zinc-100">{name}</p>
            <p className="font-mono text-xs text-zinc-500">
              {info.tasks} task{info.tasks === 1 ? "" : "s"} · <span className={info.open > 0 ? "text-sky-300" : "text-zinc-500"}>{info.open} active</span>
            </p>
          </div>
          <ul className="mt-3 grid gap-1 border-t border-zinc-800/70 pt-3">
            {(tasks ?? []).filter((t) => t.repoName === name).slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link href={`/tasks/${t.id}`} className="group flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-emerald-300">
                  <span className="truncate">#{t.issueNumber} {t.issueTitle}</span>
                  <ArrowUpRight size={13} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </CardPad>
      ))}
    </div>
  );
}
