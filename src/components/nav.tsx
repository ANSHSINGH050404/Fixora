"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Command, CornerDownLeft, FolderGit2, LayoutDashboard, ListTodo, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tasks", label: "Tasks", icon: ListTodo },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

interface PaletteTask {
  id: string;
  status: string;
  issueNumber: number | null;
  issueTitle: string;
  repoName: string;
}

export function Nav() {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-300 to-emerald-600 text-zinc-950 shadow-[0_0_16px_-2px_rgb(52_211_153/0.6)]">
              <Bot size={17} strokeWidth={2.5} aria-hidden />
            </span>
            <span className="font-mono text-sm font-bold tracking-tight text-zinc-100">Fixora</span>
          </Link>
          <nav className="flex items-center gap-1" aria-label="Primary">
            {LINKS.map((l) => {
              const active = pathname === l.href || (l.href !== "/dashboard" && pathname.startsWith(l.href));
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm transition-colors",
                    active ? "bg-zinc-800/80 text-zinc-50" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden cursor-pointer items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-600 hover:text-zinc-300 sm:inline-flex"
            >
              <Command size={13} aria-hidden />
              <span>Jump to…</span>
              <kbd className="rounded border border-zinc-700 bg-zinc-950 px-1 font-mono text-[10px] text-zinc-400">⌘K</kbd>
            </button>
          </div>
        </div>
      </header>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<PaletteTask[]>([]);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((j) => setTasks(((j.tasks ?? []) as PaletteTask[]).slice(0, 30)))
      .catch(() => undefined);
  }, []);

  const q = query.trim().toLowerCase();
  const pageHits = LINKS.filter((l) => l.label.toLowerCase().includes(q)).map((l) => ({
    id: `page:${l.href}`,
    label: `Go to ${l.label}`,
    hint: l.href,
    icon: l.icon,
    run: () => router.push(l.href),
  }));
  const taskHits = (q ? tasks.filter((t) => `${t.issueTitle} ${t.repoName} ${t.issueNumber}`.toLowerCase().includes(q)) : tasks.slice(0, 7)).map((t) => ({
    id: `task:${t.id}`,
    label: `#${t.issueNumber ?? "?"} ${t.issueTitle}`,
    hint: t.repoName,
    icon: ListTodo,
    run: () => router.push(`/tasks/${t.id}`),
  }));
  const items = [...pageHits, ...taskHits].slice(0, 12);

  const go = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    item.run();
  }, [items, onClose]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    setCursor(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      if (e.key === "Enter") go(cursor);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cursor, go, items.length, onClose]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label="Command palette">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-zinc-950/70 backdrop-blur-sm" />
      <div className="animate-rise relative w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl shadow-black/60">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4">
          <Command size={15} className="shrink-0 text-zinc-500" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search tasks or jump to a page…"
            className="w-full bg-transparent py-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none"
          />
          <kbd className="rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-72 overflow-y-auto p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-zinc-500">No matches. Try an issue title or repo name.</p>}
          {items.map((item, i) => (
            <button
              key={item.id}
              data-index={i}
              type="button"
              onMouseEnter={() => setCursor(i)}
              onClick={() => go(i)}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                i === cursor ? "bg-zinc-800 text-zinc-50" : "text-zinc-300",
              )}
            >
              <item.icon size={15} className="shrink-0 text-zinc-500" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-600">{item.hint}</span>
              {i === cursor && <CornerDownLeft size={13} className="shrink-0 text-zinc-500" aria-hidden />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
