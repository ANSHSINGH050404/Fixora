"use client";

import dynamic from "next/dynamic";
import type { Monaco } from "@monaco-editor/react";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  CircleX,
  ExternalLink,
  FileDiff,
  FlaskConical,
  GitBranch,
  Inbox,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import {
  Button,
  EmptyState,
  Input,
  Notice,
  PageHeader,
  ProgressBar,
  Skeleton,
  StageStepper,
  StatusBadge,
  isTerminalStatus,
  prettyStatus,
  stageIndexFor,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatMs, pluralize, timeAgo } from "@/lib/format";
import { CopyButton } from "@/components/copy-button";

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => <Skeleton className="h-[480px] !rounded-lg" />,
});

function defineFixoraTheme(monaco: Monaco) {
  monaco.editor.defineTheme("fixora-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "63636b", fontStyle: "italic" },
      { token: "keyword", foreground: "5eead4" },
      { token: "string", foreground: "a7f3d0" },
      { token: "number", foreground: "fcd34d" },
    ],
    colors: {
      "editor.background": "#09090b",
      "editor.lineHighlightBackground": "#18181b",
      "editorLineNumber.foreground": "#52525b",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editorWidget.background": "#18181b",
      "editorWidget.border": "#3f3f46",
      "diffEditor.insertedTextBackground": "#10b98122",
      "diffEditor.removedTextBackground": "#f43f5e22",
    },
  });
}

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
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Timeline");
  const [token, setToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) setDetail((await res.json()) as Detail);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
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

  if (failed && !detail) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load this task"
        hint="It may have been removed, or the server is unreachable."
        action={<Button variant="ghost" size="sm" onClick={() => { setFailed(false); void load(); }}>Retry</Button>}
      />
    );
  }

  if (!detail) {
    return (
      <div className="grid gap-6" aria-label="Loading task">
        <div>
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-2 h-8 w-3/4" />
          <div className="mt-3 flex gap-2"><Skeleton className="h-6 w-32" /><Skeleton className="h-6 w-24" /></div>
        </div>
        <Skeleton className="h-10" />
        <div className="grid gap-2"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      </div>
    );
  }

  const terminal = isTerminalStatus(detail.task.status);
  const completedTypes = detail.steps.filter((s) => s.status === "success").map((s) => s.type);
  const stepIndex = stageIndexFor(detail.task.status, completedTypes);
  const passedTests = detail.testRuns.filter((t) => t.passed).length;

  const tabCount = (t: (typeof TABS)[number]): string | null => {
    switch (t) {
      case "Hypotheses": return detail.hypotheses.length > 0 ? String(detail.hypotheses.length) : null;
      case "Evidence": return detail.evidence.length > 0 ? String(detail.evidence.length) : null;
      case "Diff": return detail.patch ? `+${detail.patch.additions} −${detail.patch.deletions}` : null;
      case "Tests": return detail.testRuns.length > 0 ? `${passedTests}/${detail.testRuns.length}` : null;
      case "Review": return detail.review ? (detail.review.approved ? "✓" : "!") : null;
      default: return null;
    }
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        title={`#${detail.issue.number} ${detail.issue.title}`}
        description={`${detail.repository.owner}/${detail.repository.name} · opened ${timeAgo(detail.task.createdAt)} · updated ${timeAgo(detail.task.updatedAt)}${detail.task.attempt > 1 ? ` · attempt ${detail.task.attempt}` : ""}`}
        actions={
          <>
            <StatusBadge status={detail.task.status} />
            {!terminal && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 font-mono text-[11px] text-sky-300">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-sky-400" aria-hidden /> live
              </span>
            )}
          </>
        }
      />
      {detail.issue.labels.length > 0 && (
        <div className="-mt-3 flex flex-wrap gap-1.5">
          {detail.issue.labels.map((l) => (
            <span key={l} className="rounded-full border border-zinc-700/80 px-2 py-0.5 text-xs text-zinc-400">{l}</span>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-[11px] uppercase tracking-widest text-zinc-500">
            {terminal ? prettyStatus(detail.task.status) : <>Current stage · <span className="text-sky-300">{prettyStatus(detail.task.currentStage ?? detail.task.status)}</span></>}
          </p>
          {detail.task.status === "READY_FOR_PR" && (
            <button type="button" onClick={() => setTab("PR")} className="cursor-pointer font-mono text-[11px] text-emerald-300 hover:underline">
              review PR proposal →
            </button>
          )}
        </div>
        <StageStepper currentIndex={stepIndex} failed={detail.task.status === "FAILED"} />
      </div>

      {detail.task.error && <Notice tone="error">{detail.task.error}</Notice>}
      {notice && <Notice tone={notice.startsWith("Pull request #") ? "success" : "info"}>{notice}</Notice>}

      <div className="sticky top-14 z-30 -mx-1 border-b border-zinc-800/80 bg-zinc-950/85 px-1 pb-2 backdrop-blur-md" role="tablist" aria-label="Task sections">
        <div className="flex gap-1 overflow-x-auto pt-1">
          {TABS.map((t) => {
            const count = tabCount(t);
            return (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  tab === t ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200",
                )}
              >
                {t}
                {count && (
                  <span className={cn(
                    "rounded-full px-1.5 font-mono text-[10px]",
                    tab === t ? "bg-zinc-700 text-zinc-200" : "bg-zinc-800/80 text-zinc-500",
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="animate-rise" key={tab}>
        {tab === "Timeline" && <Timeline steps={detail.steps} />}
        {tab === "Hypotheses" && <Hypotheses hyps={detail.hypotheses} />}
        {tab === "Evidence" && <EvidenceTable rows={detail.evidence} />}
        {tab === "Diff" && <DiffView diff={detail.patch?.diff ?? ""} files={detail.patch?.filesChanged ?? []} additions={detail.patch?.additions ?? 0} deletions={detail.patch?.deletions ?? 0} />}
        {tab === "Tests" && <Tests runs={detail.testRuns} />}
        {tab === "Review" && <Review review={detail.review} />}
        {tab === "PR" && (
          <PRPanel pr={detail.pr} status={detail.task.status} token={token} setToken={setToken} onApprove={approve} approving={approving} />
        )}
      </div>
    </div>
  );
}

function Timeline({ steps }: { steps: Detail["steps"] }) {
  if (steps.length === 0) {
    return (
      <div className="grid gap-2" aria-label="Waiting for steps">
        <Skeleton className="h-[72px]" /><Skeleton className="h-[72px]" />
        <p className="text-center font-mono text-xs text-zinc-600">agent starting — first step lands in a few seconds…</p>
      </div>
    );
  }
  return (
    <ol className="relative ml-2 grid gap-2 border-l border-zinc-800 pl-0" aria-label="Agent timeline">
      {steps.map((s) => {
        const ok = s.status === "success";
        const failed = s.status === "failed";
        const running = !ok && !failed;
        return (
          <li key={s.id} className="relative pl-7">
            <span
              aria-hidden
              className={cn(
                "absolute left-[-9px] top-4 flex h-[18px] w-[18px] items-center justify-center rounded-full border bg-zinc-950",
                ok && "border-emerald-500/50 text-emerald-400",
                failed && "border-red-500/50 text-red-400",
                running && "border-sky-500/50 text-sky-300",
              )}
            >
              {ok ? <Check size={11} strokeWidth={3} /> : failed ? <CircleX size={11} /> : <Loader2 size={11} className="animate-spin" />}
            </span>
            <div className={cn(
              "rounded-xl border px-4 py-3 transition-colors",
              failed ? "border-red-800/50 bg-red-950/20" : running ? "border-sky-800/50 bg-sky-950/20" : "border-zinc-800/90 bg-zinc-900/50",
            )}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-mono text-xs font-semibold tracking-wide text-zinc-100">{s.type}</p>
                <p className="font-mono text-[11px] tabular-nums text-zinc-600">
                  {timeAgo(s.startedAt)}{s.durationMs != null ? ` · ${formatMs(s.durationMs)}` : running ? " · running…" : ""}
                </p>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-zinc-300">{s.summary || (running ? "Working…" : "")}</p>
              {s.error && <p className="mt-1.5 rounded-md border border-red-800/40 bg-red-950/30 px-2.5 py-1.5 font-mono text-xs text-red-300">{s.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Hypotheses({ hyps }: { hyps: Hypothesis[] }) {
  if (hyps.length === 0) return <EmptyState icon={FlaskConical} title="No hypotheses yet" hint="The agent proposes 2–5 candidate root causes once code exploration finishes." />;
  return (
    <div className="grid gap-3">
      {hyps.map((h, i) => {
        const pct = Math.round(h.confidence > 1 ? h.confidence : h.confidence * 100);
        return (
          <article key={h.id} className={cn(
            "rounded-xl border p-5",
            h.status === "confirmed" ? "border-emerald-500/40 bg-emerald-500/[0.05]" : h.status === "rejected" ? "border-zinc-800/70 bg-zinc-900/40 opacity-75" : "border-zinc-800/90 bg-zinc-900/50",
          )}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-[11px] text-zinc-500">Hypothesis {i + 1}</p>
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] font-medium ring-1 ring-inset",
                h.status === "confirmed" && "bg-emerald-500/15 text-emerald-300 ring-emerald-500/40",
                h.status === "rejected" && "bg-zinc-500/10 text-zinc-500 ring-zinc-500/25",
                h.status === "proposed" && "bg-violet-500/10 text-violet-300 ring-violet-500/30",
              )}>
                {h.status === "confirmed" && <CircleCheck size={11} aria-hidden />}{h.status}
              </span>
            </div>
            <p className="mt-1.5 font-medium text-zinc-50">{h.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{h.description}</p>
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar value={pct} className="max-w-xs flex-1" />
              <span className="font-mono text-xs tabular-nums text-zinc-400">{pct}%</span>
            </div>
            {h.conclusion && <p className="mt-3 border-l-2 border-emerald-500/50 pl-3 text-sm text-zinc-300">{h.conclusion}</p>}
          </article>
        );
      })}
    </div>
  );
}

function EvidenceTable({ rows }: { rows: EvidenceRow[] }) {
  if (rows.length === 0) return <EmptyState icon={Inbox} title="No evidence yet" hint="File reads, search hits, and observations land here as the agent explores." />;
  return (
    <div className="grid gap-2">
      {rows.map((e) => (
        <div key={e.id} className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3">
          <p className="font-mono text-xs">
            <span className="font-semibold text-cyan-300">{e.kind}</span>
            {e.file && <span className="text-zinc-300"> · {e.file}{e.line ? `:${e.line}` : ""}</span>}
          </p>
          <p className="mt-1 text-sm text-zinc-400">{e.detail}</p>
          {e.snippet && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-zinc-800/60 bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-300">{e.snippet}</pre>
          )}
        </div>
      ))}
    </div>
  );
}

function DiffView({ diff, files, additions, deletions }: { diff: string; files: string[]; additions: number; deletions: number }) {
  if (!diff) return <EmptyState icon={FileDiff} title="No patch yet" hint="The agent modifies code only after a fix plan exists — the diff appears here." />;
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/90 bg-zinc-900/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 px-4 py-3">
        <p className="text-sm text-zinc-300">
          {pluralize(files.length, "file")} changed
          <span className="ml-2 font-mono text-xs text-zinc-500">{files.join(", ")}</span>
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-emerald-300">+{additions}</span>
          <span className="font-mono text-xs text-red-300">−{deletions}</span>
          <CopyButton text={diff} label="Copy diff" />
        </div>
      </div>
      <MonacoEditor
        height="480px"
        language="diff"
        value={diff}
        theme="fixora-dark"
        beforeMount={defineFixoraTheme}
        options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12.5, padding: { top: 12 } }}
      />
    </div>
  );
}

function Tests({ runs }: { runs: TestRun[] }) {
  if (runs.length === 0) return <EmptyState icon={FlaskConical} title="No test runs yet" hint="Targeted tests, typechecks, and lint results stream in after implementation." />;
  const passed = runs.filter((r) => r.passed).length;
  const allGreen = passed === runs.length;
  return (
    <div className="grid gap-3">
      <div className={cn(
        "flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm",
        allGreen ? "border-emerald-800/50 bg-emerald-950/30 text-emerald-200" : "border-red-800/50 bg-red-950/30 text-red-200",
      )}>
        {allGreen ? <CircleCheck size={16} aria-hidden /> : <CircleX size={16} aria-hidden />}
        {passed}/{runs.length} checks passing{allGreen ? " — safe to review." : " — failures classified below."}
      </div>
      <div className="grid gap-2">
        {runs.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3">
            <span className={cn("mt-0.5", r.passed ? "text-emerald-400" : "text-red-400")}>
              {r.passed ? <CircleCheck size={15} aria-hidden /> : <CircleX size={15} aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-xs text-zinc-100">{r.command}</p>
              <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-500">
                {r.kind} · exit {r.exitCode ?? "?"} · {formatMs(r.durationMs)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Review({ review }: { review: Detail["review"] }) {
  if (!review) return <EmptyState icon={ShieldCheck} title="No review yet" hint="An independent reviewer inspects the patch for correctness, security, and scope." />;
  const approved = Boolean(review.approved);
  return (
    <div className="grid gap-3">
      <div className={cn(
        "rounded-xl border px-4 py-3.5",
        approved ? "border-emerald-800/50 bg-emerald-950/30" : "border-amber-800/50 bg-amber-950/30",
      )}>
        <p className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
          {approved ? <CircleCheck size={16} className="text-emerald-400" aria-hidden /> : <AlertTriangle size={16} className="text-amber-400" aria-hidden />}
          {approved ? "APPROVED" : "CHANGES REQUESTED"}
          <span className="font-mono text-xs font-normal text-zinc-400">severity: {review.severity}</span>
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{review.summary}</p>
      </div>
      {review.findings.map((f, i) => (
        <div key={i} className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 px-4 py-3">
          <p className="font-mono text-xs">
            <span className={cn(
              "font-semibold",
              f.severity === "critical" || f.severity === "high" ? "text-red-300" : f.severity === "medium" ? "text-amber-300" : "text-zinc-400",
            )}>
              {f.severity.toUpperCase()}
            </span>
            <span className="text-zinc-500"> · {f.category}{f.file ? ` · ${f.file}` : ""}</span>
          </p>
          <p className="mt-1 text-sm text-zinc-300">{f.message}</p>
          {f.suggestion && <p className="mt-1 text-sm text-zinc-500"><span className="text-zinc-400">Suggestion:</span> {f.suggestion}</p>}
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
  if (!pr) return <EmptyState icon={GitBranch} title="No PR proposal yet" hint="It appears here after the patch passes review — nothing pushes without your approval." />;
  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-500/[0.03]">
      <div className="border-b border-zinc-800/80 px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-widest text-emerald-300/80">Ready to create pull request</p>
        <p className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-50">{pr.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-950 px-2 py-1">
            <GitBranch size={12} aria-hidden /> {pr.branch}
          </span>
          <CopyButton text={pr.branch} label="Copy branch" />
          <span>status: {pr.status}{pr.number ? ` · #${pr.number}` : ""}</span>
        </div>
        {pr.url && (
          <a href={pr.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-emerald-300 hover:underline">
            {pr.url} <ExternalLink size={13} aria-hidden />
          </a>
        )}
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap px-5 py-4 font-mono text-xs leading-relaxed text-zinc-300">{pr.body}</pre>
      {status === "READY_FOR_PR" && (
        <div className="grid gap-2.5 border-t border-zinc-800/80 px-5 py-4">
          <label className="grid gap-1.5 text-sm text-zinc-300">
            <span className="font-medium">GitHub token with push rights <span className="font-normal text-zinc-500">(used once, never stored)</span></span>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_…" autoComplete="off" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button loading={approving} disabled={!token} onClick={onApprove}>Create PR</Button>
            <Button variant="ghost" onClick={() => window.open("https://github.com", "_blank")}>Review diff first</Button>
          </div>
        </div>
      )}
    </div>
  );
}
