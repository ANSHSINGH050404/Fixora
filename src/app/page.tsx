import Link from "next/link";
import { ArrowRight, FlaskConical, GitPullRequest, Play, ScanSearch, TestTube2 } from "lucide-react";
import { Button } from "@/components/ui";
import { HeroTerminal } from "@/components/hero-terminal";

const PIPELINE = [
  { icon: ScanSearch, step: "01", title: "Understand", desc: "Issue analysis plus a ranked map of the files that matter — never the whole repo in one prompt." },
  { icon: FlaskConical, step: "02", title: "Hypothesize", desc: "2–5 root-cause hypotheses with evidence, confidence scores, and explicit conclusions." },
  { icon: TestTube2, step: "03", title: "Reproduce", desc: "Sandboxed test runs and generated repro scripts. No executable proof, no code changes." },
  { icon: GitPullRequest, step: "04", title: "Fix + Verify", desc: "Minimal patch, self-repair loop, independent review — then a PR proposal for your approval." },
];

const STATS: Array<[string, string]> = [
  ["11", "agent stages per run"],
  ["≤3", "self-repair attempts"],
  ["100%", "human-approved PRs"],
  ["0", "auto-merges, ever"],
];

export default function Home() {
  return (
    <div className="grid gap-14 py-10">
      {/* hero */}
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="animate-rise">
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-emerald-300">
            <Play size={11} aria-hidden /> autonomous software engineering
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-zinc-50 sm:text-5xl">
            Give Fixora a GitHub issue.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-cyan-300 bg-clip-text text-transparent">
              Get back a reviewed PR.
            </span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-400">
            An agent that maps your codebase, forms hypotheses, reproduces the bug,
            implements a minimal fix, runs the tests, reviews its own patch —
            and stops for your approval before touching your repo.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/dashboard">
              <Button size="md">
                Run the 2-min demo <ArrowRight size={15} aria-hidden />
              </Button>
            </Link>
            <Link href="/tasks">
              <Button size="md" variant="ghost">
                Browse runs
              </Button>
            </Link>
          </div>
          <dl className="mt-9 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
            {STATS.map(([v, l]) => (
              <div key={l} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5">
                <dt className="sr-only">{l}</dt>
                <dd className="font-mono text-xl font-semibold text-zinc-50">{v}</dd>
                <dd className="mt-0.5 text-[11px] leading-snug text-zinc-500">{l}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="animate-rise [animation-delay:120ms]">
          <HeroTerminal />
          <p className="mt-2 text-center font-mono text-[11px] text-zinc-600">replay · issue #123 → PR proposal in under a minute</p>
        </div>
      </div>

      {/* pipeline */}
      <section aria-label="How it works">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PIPELINE.map((p) => (
            <div key={p.step} className="group rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-5 transition-colors hover:border-emerald-500/30">
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 text-emerald-300 transition-colors group-hover:border-emerald-500/30">
                  <p.icon size={17} aria-hidden />
                </span>
                <span className="font-mono text-xs text-zinc-600">{p.step}</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-zinc-100">{p.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{p.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
