<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="Farmer" height="64">
  </picture>
</p>

Self-hosted time tracking for teams, built and used at [Profico](https://profi.co).

This will eventually have a cooler description, I promise.

## What's inside

- **Timesheet** — day, week and month views, tied to client → project → task, at 15-minute granularity. A home page shows this week and this month against the hour fund.
- **Automation** — background jobs fill in what nobody typed: recurring blocks, Google Calendar meetings, and work-time blocks built from GitHub commits. "Assemble my day" proposes a day's entries and writes nothing until you accept. Filing rules send a recurring meeting to the same project every time.
- **Absence** — Vacation, Sick Leave and Paid Leave are ordinary entries against built-in tasks, so absence reporting comes from the same table as work.
- **Reports** — Time (by client, project or teammate), Overtime, Tracking (logged time against the month's target) and Absence, for a week, month, quarter, year or custom range. The Time report exports to CSV.
- **Hours** — a monthly hour fund, public holidays for the organization's country, per-person working hours and person types (employee, student, contractor; billable, overhead, hourly).
- **People** — organizations with an Admin role, per-project roles (Member / Team Lead / PM), Team Lead people lists, and email invitations (Resend or SMTP) that can also go out as a Slack DM.
- **Projects** — a page per project with its hours, team and settings; emoji or uploaded icons.
- **Integrations** — a GitHub App per organization for commits, Google Calendar per person, and Slack per organization for reminder DMs, a month-end reminder and an admin digest. Reminders also go out as web push.
- **Assistant** — a chat page backed by OpenRouter (the organization's own key) that answers questions about tracked time and logs more of it. It can do only what the person asking can do.
- **MCP server** — the same tools over Streamable HTTP at `/api/mcp/<org-slug>`, for Claude Code or any other MCP client.
- **CLI** — `farmer`, a command-line tool to log and read your own time. Install it with `curl -fsSL <app-url>/cli | sh` and sign in from the browser. See [apps/cli/README.md](apps/cli/README.md).
- **Harvest import** — drop the Harvest CSV exports on Settings → Import. Importing the same files again changes nothing, and the latest run can be undone.
- **REST** — read-only `/api/v1/projects` and `/api/v1/time-entries`, using the same session as the app.
- **Single-organization mode** — set `SINGLE_ORG_SLUG` for a one-workspace, invite-only instance.
- Light and dark themes.

## Stack

Bun + Turborepo, three workspaces. `apps/web` is a [TanStack Start](https://tanstack.com/start) app — React 19, TanStack Router/Query, shadcn components on Base UI. `apps/cli` is the `farmer` command-line tool, compiled with Bun. `packages/core` owns everything else: Drizzle + Postgres, [better-auth](https://better-auth.com) with the organization and MCP plugins, and all business logic as plain functions that take `{ organizationId, userId }` explicitly. The web app is a thin layer over core; the MCP server and the REST endpoints call the same services.

## Running it locally

You need [Bun](https://bun.sh) and Docker (or a Postgres you already have).

```bash
bun install
docker compose up -d    # Postgres on localhost:5433, Garage (S3 for uploads) on localhost:3900
cp .env.example .env    # then set BETTER_AUTH_SECRET (openssl rand -hex 32)

# Bun doesn't read the root .env from inside workspaces, so link it once:
ln -s ../../.env apps/web/.env
ln -s ../../.env packages/core/.env

bun run db:migrate
bun run dev
```

Open the URL that `vite dev` prints (http://localhost:3000, or the next free port). In development (`NODE_ENV=development`, which `vite dev` sets), `/login` has an email and password form, so you can sign up without a Google Cloud project. The first account you create makes your organization. `bun run dev` also seeds the built-in tasks and starts a worker that runs the automation sync.

Only `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are required. Everything else in `.env.example` is optional and documented there: email, uploads, GitHub, Google, Slack and push.

For demo data (one client, project and task — not safe to run twice):

```bash
cd packages/core && bun run db:seed
```

### Integration credentials

- **Google** signs people in (the only sign-in method in production) and, as a separate grant requested from Settings → Integrations, reads their calendar (`calendar.events.readonly`). Enable the Calendar API on the OAuth client. Farmer requests offline access, so sync keeps working after the first access token expires.
- **GitHub** needs two things, and they aren't interchangeable: an OAuth app (identity — matching activity to people, `GITHUB_CLIENT_ID`/`SECRET`) and a GitHub App (reads repos, commits and pull requests, installed once per organization, `GITHUB_APP_*`). Give the App read access to **Contents** and **Pull requests**, and the organization permission **Members** (read); without Pull requests, PR and review activity is silently empty, and without Members nobody can connect an organization's installation. Only an owner of the GitHub account or organization can connect it. The same App serves the CLI's binary downloads, so its installation must include the releases repository.
- **Slack** needs an app with the `chat:write`, `im:write`, `users:read` and `users:read.email` bot scopes and `{BETTER_AUTH_URL}/api/slack/callback` as a redirect URL. An admin installs it per organization from Settings → Integrations; no token is ever pasted into the app.
- **OpenRouter** is not an environment variable. An admin pastes the organization's key in Settings → Integrations.

## Deploying

`vite build` emits a fetch handler with nothing to serve it, so production runs on `apps/web/server.ts` — a Bun server that serves the build, preloads static assets and runs the background jobs in-process. The `Dockerfile` at the repo root builds it:

```bash
docker build -t farmer .
docker run -p 3000:3000 --env-file .env farmer
```

On every start the image applies pending migrations and seeds the built-in tasks (`RUN_MIGRATIONS` / `RUN_SEED` turn these off).

The jobs — automation sync, log reminders, Slack reminders, the upload sweep and the audit sweep — assume a single instance. To run them apart from the web host, set `AUTOMATION_SYNC_ENABLED`, `LOG_REMINDERS_ENABLED`, `SLACK_REMINDERS_ENABLED`, `UPLOAD_SWEEP_ENABLED` and `AUDIT_SWEEP_ENABLED` to `false` there and run exactly one `bun run worker` (from `packages/core`). `ASSISTANT_ENABLED=false`, `MCP_ENABLED=false` and `CLI_ENABLED=false` remove those features from a deployment.

## Development

Commands, architecture notes and the sharp edges we've already hit are in [CLAUDE.md](CLAUDE.md), which doubles as the contributor guide. It carries the commands, the lint rules and the few rules that hold everywhere; each workspace has its own ([packages/core](packages/core/CLAUDE.md), [apps/web](apps/web/CLAUDE.md), [apps/cli](apps/cli/CLAUDE.md)), and one subsystem per file lives under [docs/domains/](docs/domains/). The short version:

- `bun run db:generate` / `bun run db:migrate` after schema changes (Drizzle)
- `packages/core/src/db/schema/auth.ts` is generated by better-auth's CLI — regenerate it with `bun run auth:generate` from `packages/core`, never edit it by hand
- `bun run test` runs the `packages/core` suite against an in-process PGLite — real Postgres, real migrations, no container and no `DATABASE_URL` — and the `apps/cli` suite
- `bun run check` (oxfmt + oxlint) and `bun run typecheck` at the repo root are what CI runs

## License

[AGPLv3](LICENSE)
