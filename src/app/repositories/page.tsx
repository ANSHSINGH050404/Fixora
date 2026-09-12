"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";

interface TaskRow {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
}

export default function RepositoriesPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks((j.tasks ?? []) as TaskRow[]))
      .catch(() => undefined);
  }, []);

  const repos = new Map<string, { tasks: number; open: number }>();
  for (const t of tasks) {
    const r = repos.get(t.repoName) ?? { tasks: 0, open: 0 };
    r.tasks += 1;
    if (!["PR_CREATED", "FAILED", "CANCELLED"].includes(t.status)) r.open += 1;
    repos.set(t.repoName, r);
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold text-zinc-50">Repositories</h1>
      {repos.size === 0 && (
        <Card><p className="text-sm text-zinc-500">No repositories under investigation yet.</p></Card>
      )}
      {[...repos.entries()].map(([name, info]) => (
        <Card key={name}>
          <p className="font-mono text-sm font-semibold text-zinc-100">{name}</p>
          <p className="mt-1 text-sm text-zinc-400">
            {info.tasks} task(s) · {info.open} active
          </p>
          <div className="mt-2 grid gap-1">
            {tasks.filter((t) => t.repoName === name).slice(0, 5).map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`} className="text-sm text-emerald-400 hover:underline">
                #{t.issueNumber} {t.issueTitle}
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
