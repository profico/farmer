# CLAUDE.md

This file gives guidance to any coding agent that works in this repository. At each level, `AGENTS.md` is a symlink to `CLAUDE.md`, so Claude Code and the other agents read the same text.

This file is the always-loaded half. The rest is split so a task pays only for
what it touches — see **Where the rest lives** below.

## Commands

Bun workspaces (`apps/*`, `packages/*`) orchestrated by Turborepo. Run from repo root unless noted.

```bash
bun install                 # installs all workspaces
bun run setup               # .env from .env.example (new BETTER_AUTH_SECRET), the workspace .env
                            # links, migrations, built-in tasks, demo data once an org exists.
                            # Run after `docker compose up -d`; safe to run again (scripts/setup.ts)
bun run dev                 # turbo: starts apps/web (vite dev --port 3000, falls back to 3001+ if occupied — check the log's "Local:" line, don't assume 3000)
bun run build               # turbo: builds all workspaces
bun run test                # turbo: runs the bun test suites of packages/core, apps/cli and apps/web
bun run check               # oxfmt --check + oxlint — what CI runs
bun run typecheck           # turbo: tsc --noEmit in every workspace — also what CI runs
bun run lint                # oxlint only
bun run format              # oxfmt --write

# Database (packages/core, run through root turbo)
bun run db:generate         # drizzle-kit generate → packages/core/drizzle/*.sql
bun run db:migrate          # drizzle-kit migrate
bun run db:check            # `select 1` sanity check
bun run db:studio           # drizzle-kit studio
```

Package-local scripts — run from `packages/core`:
```bash
bun run auth:generate        # regenerates src/db/schema/auth.ts from src/auth/index.ts.
                              # auth.ts is CLI-owned — never hand-edit it. Run this after changing any
                              # better-auth plugin config, then db:generate + db:migrate.
bun run db:seed-tasks        # site-scoped built-in tasks + each org's starter tasks. Idempotent. `vite dev`
                              # (the `farmer:seed-site-tasks` plugin) and the Docker entrypoint both run it.
bun run db:seed              # demo data: clients, projects, assignments, an hour fund. Dev only.
                              # A second run changes nothing. Needs an organization (sign up first).
bun run db:seed-assistant-ui # an assistant thread holding every renderer construct plus a suspended
                              # approval, so no model call is spent. Idempotent by title, dev only.
                              # Optional args: [org-slug] [user-email].
bun run bench:assistant      # model benchmark through the real assistant loop. Needs OPENROUTER_API_KEY and
                              # costs money. `-- --stub` runs without a key. See `scripts/assistant-benchmark/README.md`.
bun run db:deploy            # src/db/migrate.ts — applies pending migrations without drizzle-kit
bun run worker               # the standalone background worker (see `docs/domains/deployment.md`)
bun test                     # the test suite (PGLite, no DATABASE_URL needed)
```

From `apps/web`:
```bash
bun run build                # vite build → dist/{client,server}, then prunes dist/client (see `apps/web/CLAUDE.md`)
bun run start                # NODE_ENV=production bun run server.ts — the production host
bun run generate-routes      # tsr generate — regenerates routeTree.gen.ts
```

### Lint and format

`oxlint` lints and `oxfmt` formats. Two root configs cover every workspace, and each workspace's `lint`/`check` script points back at them (`--config ../../oxlint.config.ts`). Both tools are root devDependencies only — a second copy in a workspace formats differently, and the drift stays invisible until CI disagrees with your editor.

- **`.oxfmtrc.json`** — tabs, double quotes, width 80, `sortImports`. It also formats JSON and CSS. Nothing lints CSS.
- **`oxlint.config.ts`** — four layers, ignoring `.claude/**`, `tools/oxlint/**`, `routeTree.gen.ts`, `src/db/schema/auth.ts` and `dist`:
  1. `plugins` + `categories.correctness` (react, react-hooks, jsx-a11y, typescript, oxc, import).
  2. **anti-slop** (vendored at `tools/oxlint/anti-slop/`, from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop)): fifteen rules that reject low-evidence TypeScript — `unknown` in a contract, a `Record<string, unknown>` value type, a hand-rolled `typeof` narrowing where a parse belongs, a type assertion with no stated invariant. All `error`, and the tree is clean of them.
  3. **stella** (vendored at `tools/oxlint/stella/`, from [stella's `.oxlint-plugins`](https://github.com/stella/stella/tree/main/.oxlint-plugins), Apache-2.0): `no-vacuous-throw-assertion` (an argument-less `.toThrow()` passes for any thrown value), `no-document-cookie`, `require-suppression-description`, `no-foreign-directive` and `no-partial-record-satisfies`. The other ~126 upstream rules were measured against this repo and skipped: domain-specific, already covered, or already passing.
  4. A handful of named rules and overrides — among them the `no-restricted-imports` override that keeps `apps/cli` off the server graph (see `apps/cli/CLAUDE.md`). See the comments in the file.

**Both plugins are vendored, not depended on — those files are ours to edit.** Three anti-slop rules carry a `Local amendment to the upstream rule` comment saying why (Zod's `.shape`; a `.catch()` handler's parameter is `unknown`; leading comments on an `export const` attach to the ExportNamedDeclaration). Read the comment before "fixing" one back. Provenance for the stella rules is in `tools/oxlint/stella/index.ts`, so a re-sync stays a diff.

**Every suppression needs a reason.** A bare `oxlint-disable` fails the build. The reason goes inline as a `-- <why>` trailer, or as a prose comment on the line above; the directive must be the **last** comment line either way.

**`SAFETY:` comments are load-bearing.** `require-safety-comment-for-type-assertion` fails the build on any non-`as const` assertion without one, so a new assertion needs a real invariant, not a restatement of the cast. The comment must be the line directly above the assertion **or** its containing statement, `//` not `{/* */}` (JSX comments are nodes, not comments), with the directive line last. Tests use `at(rows, i)` and `present(value, what)` from `src/test/harness.ts` instead of an assertion — both fail the test naming what was missing.

**Warnings do not fail the build** (about 50 today): `typescript/no-non-null-assertion` in the auth and drizzle configs and two test files, plus React and a11y findings (`react/set-state-in-effect`, `jsx-a11y/no-autofocus`, `jsx-a11y/control-has-associated-label` and a few others). They are left visible on purpose; promote a rule to `"error"` in `oxlint.config.ts` once it is burned down.

## Architecture

Three workspaces — `apps/web` (TanStack Start/React), `apps/cli` (`@farmer/cli`, the `farmer` command-line tool, see `apps/cli/CLAUDE.md`) and `packages/core` (`@farmer/core`). The split is deliberate: `packages/core` must stay reusable from another process.

**Boundary rule:** `packages/core` never imports TanStack/React. All business logic lives in `src/services/`, one file per aggregate. Every exported service function takes an explicit `ctx: { organizationId, userId }` (`src/services/types.ts`) as its first argument — **tenancy is a parameter, never ambient** — so the same function is callable from a server function, a REST route, a background job or an MCP tool.

The three workspaces each carry their own `CLAUDE.md`: `packages/core/CLAUDE.md`,
`apps/web/CLAUDE.md` and `apps/cli/CLAUDE.md`. They hold the layout of the
workspace and the rules that only apply inside it. Claude Code loads a nested
file when it touches a file in that folder. Codex and similar tools read the
`AGENTS.md` symlinks on the path from the root to the directory where they
start. If your tool does not load a workspace file, read it before you change
that workspace.

## Where the rest lives

A subsystem whose narrative is long lives under `docs/domains/`. **Read the one
you are about to change before you change it** — these are not loaded for you.

| Read this | Before you touch |
|---|---|
| `docs/domains/automation.md` | the recurring-block, meeting or GitHub commit/PR engines, the automation window, the filing rules |
| `docs/domains/assistant.md` | `assistant.service.ts`, `assistant-tools.ts`, the assistant page or its stream route |
| `docs/domains/mcp-server.md` | `mcp-tools.ts`, `api/mcp/$orgSlug.ts` or the OAuth discovery routes |
| `docs/domains/integrations.md` | GitHub, Google Calendar or Slack — credentials, callbacks, the webhook |
| `docs/domains/authentication.md` | better-auth, the login routes, or single-organization mode |
| `docs/domains/harvest-import.md` | `harvest-import.service.ts`, `lib/harvest/` or the import screen |
| `docs/domains/uploads.md` | `lib/storage.ts`, `uploads.service.ts`, `api/files/$.ts` or the upload sweep |
| `docs/domains/timer.md` | `timers.service.ts`, `jobs/timer-sweep.ts`, the stopwatch in the web app or the CLI |
| `docs/domains/api-tokens.md` | `api-tokens.service.ts`, Preferences → API tokens, the bearer-token branch in `server/api-auth.ts`, or `FARMER_TOKEN` in the CLI |
| `docs/domains/webhooks.md` | the outbound webhooks — `services/events.ts`, `webhooks.service.ts`, `jobs/webhook-delivery.ts`, the signature or the SSRF guard |
| `docs/domains/audit-log.md` | `services/audit.ts`, `recordAudit` / `recordSecurityEvent`, the better-auth audit hooks, the Audit log page, or any new service function that changes an organization |
| `docs/domains/deployment.md` | the Dockerfile, CI, the job schedulers, an env flag or PostHog |

`docs/adr/` holds the decisions that a change may contradict. `docs/plans/` holds
the design history of the Harvest import and the reminder settings.

## Rules that survive the split

These are load-bearing everywhere, so they stay here. The reason for each
is in the file named beside it.

- **Never static-import `@farmer/core/db` / `/auth` / `/services` at the top level of a route or `apps/web/src/server/*.ts`.** Import inside the handler body. It crashes hydration silently — forms fall back to native submission instead of throwing. → `apps/web/CLAUDE.md`
- **Tenancy is a parameter, never ambient.** Every service function takes `ctx` first; every query key names its organization. → `packages/core/CLAUDE.md`, `apps/web/CLAUDE.md`
- **A day holds at most 24 hours** (`MAX_DAY_SECONDS`), and `services/ledger.ts` is the one definition of what counts as logged time. Never hand-roll a `sum(durationSeconds)` with its own predicate. → `packages/core/CLAUDE.md`
- **Engines resolve tasks by `systemKey`, never by name.** A name lookup switches an engine off silently when an org renames the task. → `packages/core/CLAUDE.md`
- **A service function that changes an organization records it.** `recordAudit(ctx, entry)` after the write, and a line in `services/audit-coverage.test.ts`, which fails the suite for a function that is neither recorded nor exempt with a reason. → `docs/domains/audit-log.md`
- **Never type a glyph where an icon exists.** No `→`, `->`, `›`, `✓` or `×` as a mark in the UI: use the Phosphor icon (`ArrowRightIcon`, `CaretRightIcon`, `CheckIcon`, `XIcon`). A menu path in running text is `<MenuPath steps={["Settings", "Tasks"]} />` (`components/menu-path.tsx`). A glyph takes the font's weight and baseline, and a screen reader reads it out. Exceptions: text that is not drawn by React (the CLI, the OpenAPI markdown, a plain-string message), a math sign (`× 8h`), a terminal mock, and code comments. → `apps/web/src/components/menu-path.tsx`
- **Nothing on a request path calls an organization's webhook URL.** A service writes one outbox row through `emitEvent`; `jobs/webhook-delivery.ts` sends it. The URL came from a person and the server makes the call, so `lib/webhook-url.ts` is the SSRF boundary — read it before touching anything about webhook URLs. → `docs/domains/webhooks.md`

## Gotchas

- **Never read the org roster through better-auth's `auth.api.listMembers`.** It throws in an organization over 100 people, which a Harvest import makes routine — archived people count towards the total. `membersService.roster` (`members.service.ts`) queries the tables directly and is what `server/members.ts`'s `listMembers` server fn calls; `auth/index.ts` also raises `membershipLimit` to 10,000 for the paths that still go through better-auth. Don't confuse either with `projectsService.listMembers`, which is a per-project assignment read.
- Bun does not walk up parent directories for `.env` in a workspace — `bun run` inside `packages/core` or `apps/web` won't see the root `.env`. Each workspace package has a symlink to the root `.env`; do the same for any new workspace that reads the environment.
- `timeEntriesService.listRange` still performs writes on read — it recomputes (and drops) each day's fill block against the rows just read, bounded to the automation window. That is deliberate and commented, but a GET is not idempotent, including through `api/v1`, `farmer today` and the MCP server's `list_time_entries`. **The MCP case is the one to watch**: an agent loop re-reads a range far harder than a person opens a screen.

## Agent skills

### Issue tracker

Issues live in the `profico/farmer` GitHub Issues, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — one root `CONTEXT.md` plus `docs/adr/`. Neither `CONTEXT.md` nor a `CONTEXT-MAP.md` exists yet; that is expected, and their absence should not be flagged. See `docs/agents/domain.md`. This is the domain glossary, and it is not `docs/domains/` above — that is this repo's own subsystem documentation.

### Skills in this repo

Skills live in `.agents/skills/`. `.claude/skills` is a symlink to that folder, so every agent finds the same skills.

- `pr-review` — run it before you mark a PR ready. Run it also to review the PR of another person.
- `pr-fix` — address the review threads on a PR.
- `deslop` — clean up your diff. Run it before `pr-review`, never instead of it.
- `test-audit` — use it when you write, change or review tests.

`.agents/skills/VENDORED.md` lists the skills copied from another project, with the source and the license.

### Worktrees

Run `bun run worktree:setup` after `git worktree add`. It links the `.env` files of the new worktree to the `.env` of the main checkout. It never writes a `.env` and never makes a secret. The SessionStart hook in `.claude/settings.json` runs the script for a Claude Code session that starts in a worktree.
