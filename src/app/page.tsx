import Link from "next/link";
import { Button } from "@/components/ui";

export default function Home() {
  return (
    <div className="grid gap-8 py-12">
      <div className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">autonomous software engineering</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight text-zinc-50">
          MaintainerOS investigates your GitHub issues end-to-end.
        </h1>
        <p className="mt-4 text-lg text-zinc-400">
          Give it a repository and an issue. It maps the codebase, forms hypotheses,
          reproduces the bug, plans and implements a minimal fix, runs the tests,
          reviews its own patch — and proposes a pull request for your approval.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/dashboard">
            <Button>Open Dashboard</Button>
          </Link>
          <Link href="/tasks" className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-500">
            View Tasks
          </Link>
        </div>
      </div>
      <div className="grid gap-3 font-mono text-sm sm:grid-cols-2">
        {[
          ["01 · Understand", "Issue analysis + repository map, relevant files ranked."],
          ["02 · Hypothesize", "2–5 root-cause hypotheses with evidence and confidence."],
          ["03 · Reproduce", "Sandboxed test runs and generated repro scripts."],
          ["04 · Fix + Verify", "Minimal patch, self-repair loop, independent review, PR proposal."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="font-semibold text-zinc-100">{t}</p>
            <p className="mt-1 text-zinc-400">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
