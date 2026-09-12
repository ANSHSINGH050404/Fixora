"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700/80 bg-zinc-900/70 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
    >
      {copied ? <Check size={12} className="text-emerald-400" aria-hidden /> : <Copy size={12} aria-hidden />}
      {copied ? "Copied" : label}
    </button>
  );
}
