# Farmer

Self-hosted time tracking for teams, built and (probably) used at [Profico](https://profi.co).

This will eventually have a cooler description. All the feature descriptions below are AI generated.

## What's inside

- Time entries on day, week, and month views, tied to client → project → task, at 15-minute granularity
- Recurring blocks — rules that pre-fill repeating entries, with per-occurrence skips
- "Assemble my day" — proposes the day's meetings, work and breaks without writing anything until you accept
- Vacation and sick leave logged as ordinary entries against two built-in absence tasks, so absence reporting falls out of the same table
- Monthly close: a per-project sheet with Reported → Adjusted (PM) → Final (Admin), submitted and finalized, with the finalized figures snapshotted
- Reports: time by client/project/teammate, budget burn, tracking compliance, overtime, absence, variance, utilization, and "not on the invoice"
- Working schedules per member, public holidays per country, and a monthly hour fund that drives Expected hours
- Organizations with org roles and per-project roles (Member / Team Lead / PM), email invites; members only ever see their own org
- GitHub: an admin installs the GitHub App once per org, then each member links their account and gets commits attached to their entries
- Google Calendar: meetings sync into the timesheet on a schedule
- Slack: an admin installs the app once per org; people get reminder DMs when they forget to log
- Web push notifications, and email for invitations
- Read-only REST endpoints under `/api/v1`, using the same session auth as the app

## Stack

Bun + Turborepo, two workspaces. `apps/web` is a [TanStack Start](https://tanstack.com/start) app — React 19, TanStack Router/Query, shadcn components on Base UI. `packages/core` owns everything else: Drizzle + Postgres, [better-auth](https://better-auth.com) with the organization plugin, and all business logic as plain functions that take `{ organizationId, userId }` explicitly. The web app is a thin layer over core, so a future standalone API or MCP server can reuse the same services without touching React.

## Running it locally

You need [Bun](https://bun.sh) and Docker (or any Postgres you already have).

```bash
bun install
docker compose up -d    # Postgres on localhost:5433
cp .env.example .env    # then set BETTER_AUTH_SECRET (openssl rand -hex 32)

# Bun doesn't read the root .env from inside workspaces, so link it once:
ln -s ../../.env apps/web/.env
ln -s ../../.env packages/core/.env

bun run db:migrate
bun run dev
```

Seed the two built-in absence tasks (Vacation, Sick Leave) — the app needs them before anyone can log absence, and the command is idempotent:

```bash
cd packages/core && bun run db:seed-tasks
```

Then open http://localhost:3000 and sign in with Google — **Google is the only way in**, and signing in for the first time is what creates your account and your organization. There is no registration form and no password, so `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` are required to get past the front page even locally.

The required settings are `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and the Google OAuth pair. Email (Resend or SMTP) and the other integration credentials can stay empty until you want email invites, GitHub, Slack or Calendar sync — `.env.example` documents each block and where the callback URLs go.

### GitHub and Google credentials

Both integrations are opt-in per member under Settings → Integrations, but they need app credentials first:

- **GitHub** needs two things, and they aren't interchangeable: an OAuth app (identity — matching commits to members) and a GitHub App (the thing that actually reads repos, commits and pull requests, installed per organization). `GITHUB_CLIENT_ID`/`SECRET` belong to the former, `GITHUB_APP_*` to the latter. Give the App read access to **Contents** and **Pull requests**; without Pull requests, PR and review activity is silently empty.
- **Google** is used twice over the same OAuth client, deliberately as two separate grants: sign-in (identity only) and the Calendar link (`calendar.events`, requested separately from Settings → Integrations). Enable the Calendar API on the client. Farmer requests offline access, so sync keeps working after the first access token expires.
- **Slack** needs an app with the `chat:write`, `im:write`, `users:read` and `users:read.email` bot scopes and `{BETTER_AUTH_URL}/api/slack/callback` as a redirect URL. An admin installs it per organization from Settings → Integrations; no token is ever pasted into the app.

## Deploying

`vite build` emits a fetch handler with nothing to serve it, so production runs on `apps/web/server.ts` — a Bun server that serves the build, preloads static assets, and runs the background jobs in-process. Those jobs are what import your meetings and commits and materialize recurring blocks; nothing syncs on page load. The scheduler assumes a single instance, so if you run replicas keep `AUTOMATION_SYNC_ENABLED=true` on exactly one — or set it to `false` everywhere and run `bun run worker` (from `packages/core`) as its own container. The `Dockerfile` at the repo root builds all of this:

```bash
docker build -t farmer .
docker run -p 3000:3000 --env-file .env farmer
```

## Development

Commands, architecture notes, and the sharp edges we've already hit are in [CLAUDE.md](CLAUDE.md), which doubles as the contributor guide. The short version:

- `bun run db:generate` / `bun run db:migrate` after schema changes (Drizzle)
- `packages/core/src/db/schema/auth.ts` is generated by better-auth's CLI — regenerate it with `bun run auth:generate`, never edit it by hand
- `bun run test` runs the `packages/core` suite against an in-process PGLite — real Postgres, real migrations, no container and no `DATABASE_URL`
- `bun run check` at the repo root runs oxfmt (format + import order) and oxlint across both workspaces — the same command CI runs

## License

[Apache-2.0](LICENSE)
