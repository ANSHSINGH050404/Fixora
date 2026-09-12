"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ScriptLine {
  text: string;
  tone: "cmd" | "ok" | "work" | "dim";
}

const SCRIPT: ScriptLine[] = [
  { text: "$ fixora investigate acme/shop --issue 123", tone: "cmd" },
  { text: "✓ Issue analyzed — webhook retry fails when Redis is down [bug · high]", tone: "ok" },
  { text: "✓ Repository mapped — Next.js · 214 files · 14 relevant", tone: "ok" },
  { text: "→ Searching retry implementation… found src/queue/webhook-worker.ts", tone: "work" },
  { text: "✓ Generated 3 hypotheses · best confidence 0.72", tone: "ok" },
  { text: "✓ Bug reproduced — worker.retry.test.ts fails as expected", tone: "ok" },
  { text: "✓ Root cause: queue reference lost on Redis reconnect", tone: "ok" },
  { text: "✓ Fix plan — 3 changes across 2 files · risk: medium", tone: "ok" },
  { text: "✓ Patch applied · regression test added · tests 18/18 pass", tone: "ok" },
  { text: "✓ Code review approved — severity: low", tone: "ok" },
  { text: "→ PR proposal ready — awaiting your approval", tone: "work" },
];

const TONE_CLASS: Record<ScriptLine["tone"], string> = {
  cmd: "text-zinc-100",
  ok: "text-emerald-300",
  work: "text-sky-300",
  dim: "text-zinc-500",
};

const CHAR_MS = 14;
const LINE_PAUSE_MS = 420;
const END_HOLD_MS = 4200;

/** Looping typewriter replay of a real Fixora run. */
export function HeroTerminal() {
  const prefersReduced = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [lineCount, setLineCount] = useState(() => (prefersReduced() ? SCRIPT.length : 1));
  const [charCount, setCharCount] = useState(() => (prefersReduced() ? SCRIPT[SCRIPT.length - 1].text.length : 0));
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (prefersReduced()) return;
    let line = 0;
    let char = 0;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      const current = SCRIPT[line].text;
      if (char < current.length) {
        char += 1;
        setCharCount(char);
        timers.current.push(window.setTimeout(tick, CHAR_MS));
      } else if (line < SCRIPT.length - 1) {
        timers.current.push(
          window.setTimeout(() => {
            line += 1;
            char = 0;
            setLineCount(line + 1);
            setCharCount(0);
            tick();
          }, LINE_PAUSE_MS),
        );
      } else {
        timers.current.push(
          window.setTimeout(() => {
            line = 0;
            char = 0;
            setLineCount(1);
            setCharCount(0);
            tick();
          }, END_HOLD_MS),
        );
      }
    };
    tick();
    const stash = timers.current;
    return () => {
      cancelled = true;
      stash.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/90 shadow-[0_24px_80px_-24px_rgb(0_0_0/0.8)]" aria-label="Animated replay of a Fixora run">
      <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" aria-hidden />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" aria-hidden />
        <span className="ml-2 font-mono text-[11px] text-zinc-500">fixora — live run</span>
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" aria-hidden />
          streaming
        </span>
      </div>
      <div className="h-[340px] overflow-hidden p-4 font-mono text-[12.5px] leading-relaxed sm:text-[13px]">
        {SCRIPT.slice(0, lineCount).map((l, i) => {
          const isLast = i === lineCount - 1;
          const text = isLast ? l.text.slice(0, charCount) : l.text;
          return (
            <p key={i} className={cn("whitespace-pre-wrap break-words", TONE_CLASS[l.tone])}>
              {text}
              {isLast && <span className="ml-0.5 inline-block h-3.5 w-[7px] animate-blink bg-emerald-400 align-middle" aria-hidden />}
            </p>
          );
        })}
      </div>
    </div>
  );
}
