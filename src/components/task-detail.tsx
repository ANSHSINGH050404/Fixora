"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, GhostButton, Input, SectionTitle, StatusBadge } from "@/components/ui";
import { cn } from "@/lib/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => <div className="p-4 font-mono text-xs text-zinc-500">loading editor…</div>,
});

interface Step { id: string; type: string; status: string; summary: string; startedAt: string; completedAt: string | null; durationMs: number | null; error: string | null; }
interface Hypothesis { id: string; title: string; description: string; confidence: number; status: string; conclusion: string | null; }
interface EvidenceRow { id: string; kind: string; file: string | null; line: number | null; snippet: string; detail: string; }
interface TestRun { id: string; kind: string; command: string; exitCode: number | null; passed: number; durationMs: number; }
interface Detail {
  task: { id: string; status: string; currentStage: string | null; attempt: number; error: string | null; createdAt: string; updatedAt: string };
  repository: { url: string; owner: string; name: string; defaultBranch: string };
  issue: { number: number; title: string; body: string; state: string; labels: string[] };
  steps: Step[];
  transitions: Array<{ id: string; from: string; to: string; reason: string; createdAt: string }>;
  hypotheses: Hypothesis[];
  evidence: EvidenceRow[];
  patch: { description: string; diff: string; filesChanged: string[]; additions: number; deletions: number; status: string } | null;
  testRuns: TestRun[];
  review: { approved: number; severity: string; findings: Array<{ severity: string; category: string; file?: string; message: string; suggestion?: string }>; summary: string } | null;
  pr: { branch: string; title: string; body: string; url: string | null; number: number | null; status: string } | null;
}

interface SnapshotStep { id: string; type: string; status: string; summary: string; startedAt: string; completedAt: string | null; durationMs: number | null; error: string | null; }
interface Snapshot {
  status: string;
  stage: string | null;
  attempt: number;
  error: string | null;
  steps: SnapshotStep[];
  transitions: Detail["transitions"];
  hypotheses: Detail["hypotheses"];
  evidenceCount: number;
  testRuns: Array<{ id: string; kind: string; command: string; exitCode: number | null; passed: number; durationMs: number }>;
  review: Detail["review"];
  pr: Detail["pr"];
  patch: { filesChanged: string[]; additions: number; deletions: number } | null;
}

const TABS = ["Timeline", "Hypotheses", "Evidence", "Diff", "Tests", "Review", "PR"] as const;

const TERMINAL_STATUSES = ["READY_FOR_PR", "PR_CREATED", "FAILED", "CANCELLED"];

/** External-system subscription (SSE live timeline). Kept outside the component so the effect only synchronizes. */
function subscribeToTaskEvents(taskId: string, onSnapshot: (snap: Snapshot) => void): () => void {
  const es = new EventSource(`/api/tasks/${taskId}/events`);
  es.onmessage = (ev) => {
    try {
      const snap = JSON.parse(ev.data) as Snapshot & { error?: string };
      if (snap.error) return;
      onSnapshot(snap);
      if (TERMINAL_STATUSES.includes(snap.status)) {
        setTimeout(() => es.close(), 500);
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  es.onerror = () => es.close();
  return () => es.close();
}

export function TaskDetailView({ taskId }: { taskId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Timeline");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${taskId}`);
    if (res.ok) setDetail((await res.json()) as Detail);
  }, [taskId]);

  const applySnapshot = useCallback((snap: Snapshot) => {
    setDetail((prev) => {
      if (!prev) return prev;
      const full = prev;
      return {
        ...full,
        task: { ...full.task, status: snap.status, currentStage: snap.stage, attempt: snap.attempt, error: snap.error ?? full.task.error },
        steps: snap.steps,
        transitions: snap.transitions,
        hypotheses: snap.hypotheses,
        testRuns: snap.testRuns,
        review: snap.review,
        pr: snap.pr ?? full.pr,
        patch: snap.patch ? { ...(full.patch as Detail["patch"])!, ...snap.patch } : full.patch,
      };
    });
    // Full refresh once terminal so diff/PR bodies arrive.
    if (TERMINAL_STATUSES.includes(snap.status)) {
      void load();
    }
  }, [load]);

  useEffect(() => {
    // External synchronization (initial fetch + SSE subscription), not derived
    // state — the documented exception for set-state-in-effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return subscribeToTaskEvents(taskId, applySnapshot);
  }, [taskId, load, applySnapshot]);

  const approve = async () => {
    setApproving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}/approve-pr`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const json = (await res.json()) as { url?: string; number?: number; error?: string };
      if (!res.ok) {
        setNotice(json.error ?? "PR creation failed");
      } else {
        setNotice(`Pull request #${json.number} created: ${json.url}`);
        await load();
      }
    } finally {
      setApproving(false);
    }
  };

  if (!detail) return <p className="font-mono text-sm text-zinc-500">loading task…</p>;

  const terminal = TERMINAL_STATUSES.includes(detail.task.status);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-zinc-500">
            {detail.repository.owner}/{detail.repository.name} · issue #{detail.issue.number}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-50">{detail.issue.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={detail.task.status} />
            {detail.task.currentStage && <span className="font-mono text-xs text-zinc-400">stage: {detail.task.currentStage}</span>}
            {detail.issue.labels.map((l) => (
              <span key={l} className="rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400">{l}</span>
            ))}
          </div>
        </div>
        {!terminal && <p className="font-mono text-xs text-zinc-500">agent running — timeline streams live</p>}
      </div>

      {detail.task.error && (
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">{detail.task.error}</p>
      )}
      {notice && (
        <p className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">{notice}</p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              tab === t ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Timeline" && <Timeline steps={detail.steps} />}
      {tab === "Hypotheses" && <Hypotheses hyps={detail.hypotheses} />}
      {tab === "Evidence" && <EvidenceTable rows={detail.evidence} />}
      {tab === "Diff" && <DiffView diff={detail.patch?.diff ?? ""} files={detail.patch?.filesChanged ?? []} />}
      {tab === "Tests" && <Tests runs={detail.testRuns} />}
      {tab === "Review" && <Review review={detail.review} />}
      {tab === "PR" && (
        <PRPanel pr={detail.pr} status={detail.task.status} token={token} setToken={setToken} onApprove={approve} approving={approving} />
      )}
    </div>
  );
}

function Timeline({ steps }: { steps: Detail["steps"] }) {
  if (steps.length === 0) return <p className="font-mono text-sm text-zinc-500">no steps yet…</p>;
  return (
    <ol className="grid gap-2">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <span className={cn("mt-0.5 font-mono text-sm", s.status === "success" ? "text-emerald-400" : s.status === "failed" ? "text-red-400" : "text-amber-400")}>
            {s.status === "success" ? "✓" : s.status === "failed" ? "✕" : "→"}
          </span>
          <div className="min-w-0">
            <p className="font-mono text-xs font-semibold tracking-wide text-zinc-200">{s.type}</p>
            <p className="mt-0.5 text-sm text-zinc-400">{s.summary || (s.status === "running" ? "running…" : "")}</p>
            {s.error && <p className="mt-1 text-sm text-red-300">{s.error}</p>}
            <p className="mt-1 font-mono text-[11px] text-zinc-600">
              {new Date(s.startedAt).toLocaleTimeString()}
              {s.durationMs != null ? ` · ${s.durationMs}ms` : ""}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Hypotheses({ hyps }: { hyps: Hypothesis[] }) {
  if (hyps.length === 0) return <p className="font-mono text-sm text-zinc-500">no hypotheses yet…</p>;
  return (
    <div className="grid gap-3">
      {hyps.map((h) => (
        <Card key={h.id}>
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-zinc-100">{h.title}</p>
            <span className={cn(
              "rounded-full px-2 py-0.5 font-mono text-[11px]",
              h.status === "confirmed" ? "bg-emerald-600 text-white" : h.status === "rejected" ? "bg-zinc-700 text-zinc-400" : "bg-violet-700 text-white",
            )}>
              {h.status} · {Math.round(h.confidence > 1 ? h.confidence : h.confidence * 100)}%
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">{h.description}</p>
          {h.conclusion && <p className="mt-2 text-sm text-zinc-300">Conclusion: {h.conclusion}</p>}
        </Card>
      ))}
    </div>
  );
}

function EvidenceTable({ rows }: { rows: EvidenceRow[] }) {
  if (rows.length === 0) return <p className="font-mono text-sm text-zinc-500">no evidence yet…</p>;
  return (
    <div className="grid gap-2">
      {rows.map((e) => (
        <div key={e.id} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <p className="font-mono text-xs text-zinc-300">
            <span className="text-cyan-400">{e.kind}</span>
            {e.file ? ` · ${e.file}${e.line ? `:${e.line}` : ""}` : ""}
          </p>
          <p className="mt-1 text-sm text-zinc-400">{e.detail}</p>
          {e.snippet && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{e.snippet}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

function DiffView({ diff, files }: { diff: string; files: string[] }) {
  if (!diff) return <p className="font-mono text-sm text-zinc-500">no patch yet — the agent has not modified any code.</p>;
  return (
    <Card>
      <SectionTitle>
        {files.length} file(s) changed · {files.join(", ")}
      </SectionTitle>
      <div className="mt-3 overflow-hidden rounded-md border border-zinc-800">
        <MonacoEditor height="480px" language="diff" value={diff} theme="vs-dark" options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
      </div>
    </Card>
  );
}

function Tests({ runs }: { runs: TestRun[] }) {
  if (runs.length === 0) return <p className="font-mono text-sm text-zinc-500">no test runs yet…</p>;
  return (
    <div className="grid gap-2">
      {runs.map((r) => (
        <div key={r.id} className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <span className={cn("mt-0.5 font-mono text-sm", r.passed ? "text-emerald-400" : "text-red-400")}>
            {r.passed ? "✓" : "✕"}
          </span>
          <div>
            <p className="font-mono text-xs text-zinc-200">{r.command}</p>
            <p className="mt-0.5 font-mono text-[11px] text-zinc-500">kind: {r.kind} · exit: {r.exitCode ?? "?"} · {r.durationMs}ms</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Review({ review }: { review: Detail["review"] }) {
  if (!review) return <p className="font-mono text-sm text-zinc-500">no review yet…</p>;
  return (
    <div className="grid gap-3">
      <Card>
        <p className="text-sm text-zinc-200">
          Verdict: <strong>{review.approved ? "APPROVED" : "CHANGES REQUESTED"}</strong>
          <span className="ml-2 font-mono text-xs text-zinc-400">severity: {review.severity}</span>
        </p>
        <p className="mt-2 text-sm text-zinc-400">{review.summary}</p>
      </Card>
      {review.findings.map((f, i) => (
        <div key={i} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <p className="font-mono text-xs">
            <span className={cn(f.severity === "critical" || f.severity === "high" ? "text-red-400" : f.severity === "medium" ? "text-amber-400" : "text-zinc-400")}>
              {f.severity.toUpperCase()}
            </span>
            <span className="text-zinc-500"> · {f.category}{f.file ? ` · ${f.file}` : ""}</span>
          </p>
          <p className="mt-1 text-sm text-zinc-300">{f.message}</p>
          {f.suggestion && <p className="mt-1 text-sm text-zinc-500">Suggestion: {f.suggestion}</p>}
        </div>
      ))}
    </div>
  );
}

function PRPanel({ pr, status, token, setToken, onApprove, approving }: {
  pr: Detail["pr"];
  status: string;
  token: string;
  setToken: (t: string) => void;
  onApprove: () => void;
  approving: boolean;
}) {
  if (!pr) return <p className="font-mono text-sm text-zinc-500">no PR proposal yet — it appears after review approval.</p>;
  return (
    <Card>
      <SectionTitle>Ready to create pull request</SectionTitle>
      <p className="mt-2 text-lg font-medium text-zinc-50">{pr.title}</p>
      <p className="mt-1 font-mono text-xs text-zinc-400">branch: {pr.branch} · status: {pr.status}{pr.number ? ` · #${pr.number}` : ""}</p>
      {pr.url && <a href={pr.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm text-emerald-400 underline">{pr.url}</a>}
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 font-mono text-xs text-zinc-300">{pr.body}</pre>
      {status === "READY_FOR_PR" && (
        <div className="mt-4 grid gap-2">
          <label className="grid gap-1 text-sm text-zinc-300">
            GitHub token with push rights (required — used once, never stored)
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" autoComplete="off" />
          </label>
          <div className="flex gap-2">
            <Button disabled={approving || !token} onClick={onApprove}>{approving ? "Creating…" : "Create PR"}</Button>
            <GhostButton onClick={() => window.open("https://github.com", "_blank")}>Review Diff First</GhostButton>
          </div>
        </div>
      )}
    </Card>
  );
}
