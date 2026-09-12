"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, GhostButton, Input, SectionTitle } from "@/components/ui";

export function NewTaskForm() {
  const router = useRouter();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [issueRef, setIssueRef] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (demo: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          demo
            ? { demo: true }
            : {
                repositoryUrl,
                issueUrl: issueRef,
                branch: branch || undefined,
                token: token || undefined,
              },
        ),
      });
      const json = (await res.json()) as { task?: { id: string }; error?: string };
      if (!res.ok || !json.task) {
        setError(json.error ?? "failed to create task");
        return;
      }
      const start = await fetch(`/api/tasks/${json.task.id}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token || undefined }),
      });
      if (!start.ok) {
        const j = (await start.json()) as { error?: string };
        setError(j.error ?? "failed to start task");
        return;
      }
      router.push(`/tasks/${json.task.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>New engineering task</SectionTitle>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1 text-sm text-zinc-300">
          GitHub repository URL
          <Input
            placeholder="https://github.com/owner/repo"
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-zinc-300">
            Issue number or URL
            <Input
              placeholder="#123 or …/issues/123"
              value={issueRef}
              onChange={(e) => setIssueRef(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            Branch <span className="text-zinc-500">(optional)</span>
            <Input placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </label>
        </div>
        <label className="grid gap-1 text-sm text-zinc-300">
          GitHub token <span className="text-zinc-500">(optional — private repos / higher rate limits; never stored)</span>
          <Input
            type="password"
            placeholder="ghp_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        {error && <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => create(false)}>
            {busy ? "Working…" : "Create + Start Investigation"}
          </Button>
          <GhostButton disabled={busy} onClick={() => create(true)} title="Runs the built-in buggy-cache demo, no GitHub needed">
            {busy ? "Working…" : "Run 2-min Demo"}
          </GhostButton>
        </div>
      </div>
    </Card>
  );
}
