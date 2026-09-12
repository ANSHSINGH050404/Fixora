"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, GhostButton, Input, SectionTitle } from "@/components/ui";
import { cn } from "@/lib/utils";

interface RedactedSetting {
  key: string;
  configured: boolean;
  source: "db" | "env" | "default";
  value?: string | number;
}

interface EnvStatus {
  database: string;
  sandbox: string;
}

const SECRET_KEYS = new Set(["LLM_API_KEY", "GITHUB_TOKEN"]);

const PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.5-flash" },
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "qwen3:8b" },
];

const EMPTY_FORM = {
  LLM_BASE_URL: "",
  LLM_API_KEY: "",
  LLM_MODEL: "",
  GITHUB_TOKEN: "",
  WORKSPACE_DIR: "",
  SANDBOX_TIMEOUT_MS: "",
  MAX_REPAIR_ATTEMPTS: "",
};

function SourceBadge({ source }: { source: RedactedSetting["source"] }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-mono text-[11px]",
        source === "db" && "bg-emerald-700 text-white",
        source === "env" && "bg-blue-700 text-white",
        source === "default" && "bg-zinc-700 text-zinc-300",
      )}
      title={source === "db" ? "Overridden from this UI" : source === "env" ? "From environment variable" : "Built-in default"}
    >
      {source === "db" ? "UI override" : source === "env" ? "env" : "default"}
    </span>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<RedactedSetting[] | null>(null);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY_FORM });
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<string, { ok: boolean; text: string }>>({});

  const byKey = useCallback(
    (key: string): RedactedSetting | undefined => settings?.find((s) => s.key === key),
    [settings],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const json = (await res.json()) as { settings: RedactedSetting[] };
        setSettings(json.settings);
        // Pre-fill non-secret effective values; secrets stay empty (= keep existing).
        setForm((prev) => {
          const next = { ...prev };
          for (const s of json.settings) {
            if (!SECRET_KEYS.has(s.key) && s.value !== undefined && prev[s.key] === "") {
              next[s.key] = String(s.value);
            }
          }
          return next;
        });
      }
    } catch {
      /* offline */
    }
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const json = (await res.json()) as EnvStatus;
        setEnv({ database: json.database, sandbox: json.sandbox });
      }
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    // Initial fetch from external APIs on mount, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async (section: string, keys: string[]) => {
    setBusy(section);
    setNotices((n) => ({ ...n, [section]: undefined as never }));
    try {
      const body: Record<string, string | number> = {};
      for (const key of keys) {
        const raw = (form[key] ?? "").trim();
        if (raw === "") continue; // empty secret = keep existing; empty other = unchanged
        if (key === "SANDBOX_TIMEOUT_MS" || key === "MAX_REPAIR_ATTEMPTS") {
          const num = Number(raw);
          if (!Number.isInteger(num)) {
            setNotices((n) => ({ ...n, [section]: { ok: false, text: `${key} must be an integer` } }));
            return;
          }
          body[key] = num;
        } else {
          body[key] = raw;
        }
      }
      if (Object.keys(body).length === 0) {
        setNotices((n) => ({ ...n, [section]: { ok: false, text: "Nothing to save — fill in a value first." } }));
        return;
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { settings?: RedactedSetting[]; error?: string };
      if (!res.ok) {
        setNotices((n) => ({ ...n, [section]: { ok: false, text: json.error ?? "Save failed." } }));
        return;
      }
      // Clear saved secret fields so they don't linger in the DOM.
      setForm((f) => {
        const next = { ...f };
        for (const key of keys) if (SECRET_KEYS.has(key)) next[key] = "";
        return next;
      });
      setNotices((n) => ({ ...n, [section]: { ok: true, text: "Saved — takes effect immediately, no restart needed." } }));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const clearKey = async (key: string) => {
    setBusy(`clear-${key}`);
    try {
      await fetch(`/api/settings/${key}`, { method: "DELETE" });
      setForm((f) => ({ ...f, [key]: "" }));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const testLLM = async () => {
    setBusy("test-llm");
    try {
      const res = await fetch("/api/settings/test-llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(form.LLM_BASE_URL.trim() ? { baseUrl: form.LLM_BASE_URL.trim() } : {}),
          ...(form.LLM_API_KEY ? { apiKey: form.LLM_API_KEY } : {}),
        }),
      });
      const json = (await res.json()) as { ok: boolean; model?: string; modelCount?: number; error?: string };
      setNotices((n) => ({
        ...n,
        llm: json.ok
          ? { ok: true, text: `Connected (${json.modelCount ?? 0} models listed, using ${json.model}).` }
          : { ok: false, text: json.error ?? "Connection failed." },
      }));
    } finally {
      setBusy(null);
    }
  };

  const testGitHub = async () => {
    setBusy("test-github");
    try {
      const res = await fetch("/api/settings/test-github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(form.GITHUB_TOKEN ? { token: form.GITHUB_TOKEN } : {}) }),
      });
      const json = (await res.json()) as { ok: boolean; login?: string; error?: string };
      setNotices((n) => ({
        ...n,
        github: json.ok
          ? { ok: true, text: `Token valid — authenticated as ${json.login}.` }
          : { ok: false, text: json.error ?? "Token rejected." },
      }));
    } finally {
      setBusy(null);
    }
  };

  const notice = (section: string) => {
    const n = notices[section];
    if (!n) return null;
    return (
      <p className={cn("rounded-md border px-3 py-2 text-sm", n.ok ? "border-emerald-900 bg-emerald-950/50 text-emerald-300" : "border-red-900 bg-red-950/50 text-red-300")}>
        {n.text}
      </p>
    );
  };

  const row = (key: string) => {
    const s = byKey(key);
    return (
      <div className="flex items-center gap-2">
        {s && <SourceBadge source={s.source} />}
        {s?.configured && <span className="font-mono text-[11px] text-emerald-400">● set</span>}
        {!s?.configured && SECRET_KEYS.has(key) && <span className="font-mono text-[11px] text-amber-400">○ not set</span>}
        {s?.source === "db" && (
          <button
            onClick={() => clearKey(key)}
            disabled={busy !== null}
            className="font-mono text-[11px] text-zinc-500 underline hover:text-zinc-300 disabled:opacity-40"
            title="Revert to environment variable / default"
          >
            revert
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Settings</h1>
        <p className="mt-1 text-sm text-zinc-400">Configure the app from here — changes apply immediately, no restart, no <span className="font-mono">.env</span> editing.</p>
      </div>

      <Card>
        <SectionTitle>LLM backend</SectionTitle>
        <div className="mt-1 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { set("LLM_BASE_URL", p.baseUrl); set("LLM_MODEL", p.model); }}
              className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500 hover:text-zinc-100"
            >
              {p.label}
            </button>
          ))}
          <span className="self-center font-mono text-[11px] text-zinc-500">presets fill URL + model — paste your key below</span>
        </div>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">Base URL {row("LLM_BASE_URL")}</span>
            <Input value={form.LLM_BASE_URL} onChange={(e) => set("LLM_BASE_URL", e.target.value)} placeholder="https://generativelanguage.googleapis.com/v1beta/openai" spellCheck={false} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">Model {row("LLM_MODEL")}</span>
            <Input value={form.LLM_MODEL} onChange={(e) => set("LLM_MODEL", e.target.value)} placeholder="gemini-3.5-flash" spellCheck={false} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">API key <span className="text-zinc-500">(empty = keep existing)</span> {row("LLM_API_KEY")}</span>
            <Input type="password" value={form.LLM_API_KEY} onChange={(e) => set("LLM_API_KEY", e.target.value)} placeholder="AIza…" autoComplete="off" spellCheck={false} />
          </label>
          {notice("llm")}
          <div className="flex gap-2">
            <Button disabled={busy !== null} onClick={() => save("llm", ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"])}>
              {busy === "llm" ? "Saving…" : "Save LLM settings"}
            </Button>
            <GhostButton disabled={busy !== null} onClick={testLLM}>
              {busy === "test-llm" ? "Testing…" : "Test connection"}
            </GhostButton>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>GitHub</SectionTitle>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">Token <span className="text-zinc-500">(empty = keep existing; needed for private repos, pushing, PRs)</span> {row("GITHUB_TOKEN")}</span>
            <Input type="password" value={form.GITHUB_TOKEN} onChange={(e) => set("GITHUB_TOKEN", e.target.value)} placeholder="ghp_…" autoComplete="off" spellCheck={false} />
          </label>
          {notice("github")}
          <div className="flex gap-2">
            <Button disabled={busy !== null} onClick={() => save("github", ["GITHUB_TOKEN"])}>
              {busy === "github" ? "Saving…" : "Save token"}
            </Button>
            <GhostButton disabled={busy !== null} onClick={testGitHub}>
              {busy === "test-github" ? "Testing…" : "Test token"}
            </GhostButton>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Advanced</SectionTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">Workspace dir {row("WORKSPACE_DIR")}</span>
            <Input value={form.WORKSPACE_DIR} onChange={(e) => set("WORKSPACE_DIR", e.target.value)} spellCheck={false} />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">Sandbox timeout (ms) {row("SANDBOX_TIMEOUT_MS")}</span>
            <Input value={form.SANDBOX_TIMEOUT_MS} onChange={(e) => set("SANDBOX_TIMEOUT_MS", e.target.value)} placeholder="120000" inputMode="numeric" />
          </label>
          <label className="grid gap-1 text-sm text-zinc-300">
            <span className="flex items-center justify-between">Max repair attempts {row("MAX_REPAIR_ATTEMPTS")}</span>
            <Input value={form.MAX_REPAIR_ATTEMPTS} onChange={(e) => set("MAX_REPAIR_ATTEMPTS", e.target.value)} placeholder="3" inputMode="numeric" />
          </label>
        </div>
        {notice("advanced")}
        <div className="mt-3">
          <Button disabled={busy !== null} onClick={() => save("advanced", ["WORKSPACE_DIR", "SANDBOX_TIMEOUT_MS", "MAX_REPAIR_ATTEMPTS"])}>
            {busy === "advanced" ? "Saving…" : "Save advanced settings"}
          </Button>
        </div>
      </Card>

      <Card>
        <SectionTitle>Environment (read-only)</SectionTitle>
        <div className="mt-3 grid gap-2">
          <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 px-4 py-2.5">
            <span className="text-sm text-zinc-400">Database (restart required to change)</span>
            <span className="font-mono text-xs text-zinc-200">{env?.database ?? "…"}</span>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 px-4 py-2.5">
            <span className="text-sm text-zinc-400">Sandbox</span>
            <span className="font-mono text-xs text-zinc-200">{env?.sandbox === "docker" ? "docker (isolated)" : env?.sandbox ?? "…"}</span>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle>Security notes</SectionTitle>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-zinc-400">
          <li>API keys are encrypted at rest, never returned by any API, and never sent to the LLM.</li>
          <li>“Revert” clears a UI override and falls back to the environment variable or default.</li>
          <li>Without <span className="font-mono">DATABASE_URL</span>, overrides live in server memory and are lost on restart.</li>
          <li>Repository commands run through an allowlist (bun, bunx, git) with secrets stripped from the environment.</li>
          <li>Pushing branches and opening pull requests always require your explicit approval.</li>
        </ul>
      </Card>
    </div>
  );
}
