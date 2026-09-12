import Link from "next/link";
import { Bot } from "lucide-react";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tasks", label: "Tasks" },
  { href: "/repositories", label: "Repositories" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  return (
    <header className="border-b border-zinc-800 bg-zinc-950">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4">
        <Link href="/dashboard" className="flex items-center gap-2 font-mono text-sm font-bold text-zinc-100">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-zinc-950">
            <Bot size={18} strokeWidth={2.5} />
          </span>
          Fixora
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
