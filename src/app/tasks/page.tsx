"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card, StatusBadge } from "@/components/ui";

interface TaskRow {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
  error: string | null;
  updatedAt: string;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks((j.tasks ?? []) as TaskRow[]))
      .catch(() => undefined);
  }, []);

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold text-zinc-50">Tasks</h1>
      {tasks.length === 0 && (
        <Card>
          <p className="text-sm text-zinc-500">
            No tasks yet. <Link href="/dashboard" className="text-emerald-400 underline">Create one from the dashboard.</Link>
          </p>
        </Card>
      )}
      {tasks.map((t) => (
        <Link key={t.id} href={`/tasks/${t.id}`}>
          <Card className="transition-colors hover:border-zinc-600">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">#{t.issueNumber} {t.issueTitle}</p>
                <p className="mt-0.5 font-mono text-xs text-zinc-500">
                  {t.repoName} · updated {new Date(t.updatedAt).toLocaleString()}
                </p>
                {t.error && <p className="mt-1 truncate text-xs text-red-300">{t.error}</p>}
              </div>
              <StatusBadge status={t.status} />
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
