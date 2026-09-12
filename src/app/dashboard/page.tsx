"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NewTaskForm } from "@/components/new-task-form";
import { Card, SectionTitle, StatusBadge } from "@/components/ui";

interface TaskRow {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
  updatedAt: string;
}

export default function DashboardPage() {
  const [tasks, setTasks] = useState<TaskRow[]>([]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks((j.tasks ?? []) as TaskRow[]))
      .catch(() => undefined);
  }, []);

  const active = tasks.filter((t) => !["PR_CREATED", "FAILED", "CANCELLED"].includes(t.status));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {tasks.length} task(s) · {active.length} active
        </p>
      </div>
      <NewTaskForm />
      <Card>
        <SectionTitle>Recent tasks</SectionTitle>
        <div className="mt-3 grid gap-2">
          {tasks.length === 0 && <p className="text-sm text-zinc-500">No tasks yet — create one above or run the demo.</p>}
          {tasks.slice(0, 8).map((t) => (
            <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 px-4 py-3 transition-colors hover:border-zinc-600">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-100">
                  #{t.issueNumber} {t.issueTitle}
                </p>
                <p className="font-mono text-xs text-zinc-500">{t.repoName}</p>
              </div>
              <StatusBadge status={t.status} />
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
