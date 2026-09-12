# MaintainerOS

An autonomous AI open-source maintainer. Give it a **GitHub repository + issue** and it works the complete
engineering lifecycle — visibly, as structured agent stages, not as a black-box code generator:

```
Issue → Analyze → Map repo → Explore code → Hypotheses → Reproduce → Root cause
      → Fix plan → Implement → Test (+self-repair) → Review → PR proposal (human-approved)
```

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 5 · **Bun** (exclusively — no npm/yarn/pnpm) ·
**Effect-TS** (workflows, DI, retries, errors) · PostgreSQL + Drizzle ORM · Octokit ·
Tailwind CSS v4 · Monaco Editor · Docker sandboxing (with local allowlisted fallback)

## Quick start

```bash
bun install
cp .env.example .env   # optional — see below
bun run dev            # http://localhost:3000
```

PostgreSQL is optional for local runs. Without `DATABASE_URL` the app uses an ephemeral
in-process store (clearly labelled in Settings); with it, everything persists via Drizzle:

```bash
docker compose up -d postgres
bun run db:push
```

### Environment

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (unset → ephemeral memory store) |
| `GITHUB_TOKEN` | Default GitHub API token (per-task tokens override; also settable in Settings UI) |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | OpenAI-compatible endpoint (OpenAI, OpenRouter, Ollama…). Also settable in Settings UI |
| `SETTINGS_SECRET` | Master secret encrypting API keys saved via the Settings UI (required for key storage) |
| `WORKSPACE_DIR` | Local clones under investigation |

## Settings UI

Open `/settings` to configure everything without touching `.env`:

- **LLM backend** — provider presets (Gemini / OpenAI / Ollama / Custom), model, API key, plus a live *Test connection* button.
- **GitHub** — token with live validation.
- **Advanced** — workspace directory, sandbox timeout, repair-attempt budget.
- **Environment** — read-only: database backend, sandbox detection.

How it works: overrides persist to `app_settings` (Postgres) or server memory, take effect **immediately** (services resolve config per call), and secrets are AES-GCM encrypted with `SETTINGS_SECRET` — APIs and the UI only ever see *set/unset*, never values. `DATABASE_URL` stays env-only (it selects the store backend at boot, so changing it needs a restart).

## The 2-minute demo (no GitHub, no LLM needed)

1. Open `/dashboard` → **Run 2-min Demo**.
2. Watch the live timeline: the agent maps `demo-fixture/cache-bug`, generates hypotheses,
   reproduces the failing tests, confirms the inverted guard in `src/cache.ts`,
   applies a validated one-line fix, re-runs tests, reviews, and proposes a PR.

The fixture's tests (`bun run test:fixture`) fail on purpose — they are the bug report made executable.

## Checks

```bash
bun run test       # 23 tests incl. full end-to-end pipeline run
bun run typecheck  # tsc --noEmit
bun run build      # production Next.js build
bun run lint       # eslint
```

## Architecture

```
src/
  app/                  routes: dashboard, tasks, tasks/[id], repositories, settings + /api/*
  components/           ui primitives, new-task form, task detail (SSE timeline, Monaco diff)
  server/
    domain/             errors (Data.TaggedError), state machine, Effect Schemas, settings keys
    services/           config, settings (hot overrides), secrets (AES-GCM), settings-store,
                        logger, github (Octokit), llm, repository, sandbox, mapper,
                        store-memory + store-postgres (TaskStore interface)
    agents/             11 stages: issue-analyzer, explorer, hypotheses, reproducer,
                        fix-planner, implementation (LLM + generate-and-validate APR),
                        test-agent (failure classification), reviewer, pr-generator
    tools/              AgentTool registry — agents request tools, never infrastructure
    workflows/          run-task (orchestrator), finalize-pr (approval-gated), runtime (layers)
demo-fixture/cache-bug  intentionally buggy TS repo used by the demo + e2e test
tests/                  bun tests (state machine, agents, store, security, e2e)
```

Key design decisions:

- **Deterministic first, LLM second.** Every stage does real static analysis / execution;
  the LLM refines when `LLM_*` is configured. The demo passes with no LLM at all.
- **Implementation is gated on a fix plan**, validated by execution (`bun test` must go
  green), and can never touch tests, lockfiles, or generated files.
- **Failures are classified** (patch / pre-existing / environment) via stash-and-rerun,
  not blindly retried. Self-repair is capped at 3 attempts — no infinite loops.
- **Humans approve pushes.** The pipeline stops at `READY_FOR_PR`; `approve-pr`
  commits, pushes, and opens the PR through the GitHub API with a one-time token.
- **Untrusted input discipline:** allowlisted argv-only commands, scrubbed sandbox env,
  path-traversal guards, secret scanning in review, no tokens in logs/prompts/storage.

## API

| Method | Route | Purpose |
|---|---|---|
| `GET/POST` | `/api/tasks` | list / create (GitHub or `{demo:true}`) |
| `GET` | `/api/tasks/[id]` | full detail bundle |
| `POST` | `/api/tasks/[id]/start` | fork the background investigation |
| `GET` | `/api/tasks/[id]/events` | SSE live timeline |
| `POST` | `/api/tasks/[id]/approve-pr` | human-gated push + PR creation |
| `GET` | `/api/status` | environment capabilities (no secrets) |
| `GET/PUT` | `/api/settings` | redacted settings view / save validated overrides |
| `DELETE` | `/api/settings/:key` | revert one key to env/default |
| `POST` | `/api/settings/test-llm` | live LLM check (nothing persisted) |
| `POST` | `/api/settings/test-github` | live token check (nothing persisted) |
