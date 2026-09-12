"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Rocket } from "lucide-react";
import { Button, CardPad, Field, Input, Notice, SectionTitle } from "@/components/ui";

export function NewTaskForm() {
  const router = useRouter();
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [issueRef, setIssueRef] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"real" | "demo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (demo: boolean) => {
    setBusy(demo ? "demo" : "real");
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
      setBusy(null);
    }
  };

  return (
    <CardPad>
      <SectionTitle right={<span className="font-mono text-[11px] normal-case tracking-normal text-zinc-600">issue → understanding → PR proposal</span>}>
        New engineering task
      </SectionTitle>
      <div className="mt-4 grid gap-3.5">
        <Field label="GitHub repository URL">
          <Input
            placeholder="https://github.com/owner/repo"
            value={repositoryUrl}
            onChange={(e) => setRepositoryUrl(e.target.value)}
            spellCheck={false}
            inputMode="url"
          />
        </Field>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Issue number or URL">
            <Input
              placeholder="#123 or …/issues/123"
              value={issueRef}
              onChange={(e) => setIssueRef(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field label="Branch" hint={<span className="font-mono text-[11px] text-zinc-600">optional</span>}>
            <Input placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} spellCheck={false} />
          </Field>
        </div>
        <Field
          label="GitHub token"
          hint={<span className="font-mono text-[11px] text-zinc-600">optional · never stored</span>}
        >
          <Input
            type="password"
            placeholder="ghp_…  ·  private repos / higher rate limits"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button loading={busy === "real"} disabled={busy !== null} onClick={() => create(false)}>
            <Rocket size={15} aria-hidden /> Start investigation
          </Button>
          <Button variant="ghost" loading={busy === "demo"} disabled={busy !== null} onClick={() => create(true)} title="Runs the built-in buggy-cache demo, no GitHub needed">
            <FlaskConical size={15} aria-hidden /> Run 2-min demo
          </Button>
        </div>
      </div>
    </CardPad>
  );
}
