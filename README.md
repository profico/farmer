<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo-light.svg" alt="Farmer" height="64">
  </picture>
</p>

Farmer is self-hosted time tracking for teams. We built it at
[Profico](https://profi.co), and we use it every day.

It fills in most of the timesheet for you. Meetings come from your calendar,
work blocks come from your GitHub commits, and recurring blocks fill
themselves. You check the day, file what is left, and go home.

## Features

- **Timesheet:** day, week and month views. Each entry has a client, a
  project and a task, in 15 minute steps.
- **Timer:** a stopwatch on the web, in the CLI and in the mobile app.
- **Automation:** recurring blocks, Google Calendar meetings and work blocks
  from GitHub commits and pull requests. "Assemble my day" suggests a day and
  writes nothing until you accept it.
- **Filing rules:** send a recurring meeting to the same project each time.
- **Absence:** vacation, sick leave and paid leave are normal entries, so the
  absence reports come from the same data as the work.
- **Targets:** a monthly hour fund, public holidays for your country, and
  working hours per person. The home page shows the week and the month against
  the target.
- **Reports:** time, overtime, tracking and absence, for any period. Export to
  CSV.
- **People and roles:** an Admin role, per project roles (Member, Team Lead,
  PM) and Team Lead people lists. Invitations go out by email or as a Slack DM.
- **Reminders:** web push, Slack and the mobile app, configured per
  organization.
- **Assistant:** a chat that answers questions about your time and logs more
  of it. It can do only what you can do. Bring your own OpenRouter key.
- **MCP server:** the same tools for Claude Code or any MCP client, at
  `/api/mcp/<org-slug>`.
- **CLI:** `farmer`, to log and read your time from the terminal. See
  [apps/cli/README.md](apps/cli/README.md).
- **Mobile app:** Android and iOS, with push notifications and a timer on the
  lock screen. It is in closed testing.
- **REST API:** `/api/v1`, with an OpenAPI document at
  `/api/v1/openapi.json`. Use a session or a personal API token.
- **Webhooks:** signed events for time entries and the rest of the
  organization.
- **Audit log:** a record of each change in an organization.
- **Harvest import:** drop the Harvest CSV exports on the import page. A second
  import of the same files changes nothing, and you can undo the last run.
- **Single organization mode:** one invite-only workspace for the whole
  instance.
- **Instance settings in the UI:** email, uploads and integrations live in the
  database. An environment variable still wins, and the page says so.
- Light and dark themes.

## Run it locally

You need [Bun](https://bun.sh) and Docker or Podman.

```sh
bun install
docker compose up -d    # Postgres on 5433, Garage (S3 for uploads) on 3900
bun run setup
bun run dev
```

`bun run setup` makes a `.env` with a new secret, runs the migrations and seeds
the built-in tasks. You can run it again after each pull.

Open the URL that the dev server prints. In development, `/login` has an email
and password form. The first account makes the organization and configures the
instance. Run `bun run setup` one more time after that to add demo data.

## Configuration

Only three values are required: `DATABASE_URL`, `BETTER_AUTH_SECRET` and
`BETTER_AUTH_URL`. A platform owner sets the rest on the Infrastructure page.
`.env.example` lists every variable.

- **Google:** sign-in, and a separate calendar grant per person. Enable the
  Calendar API on the OAuth client.
- **GitHub:** an OAuth app for identity, and a GitHub App for repositories.
  Give the App read access to Contents, Pull requests and Members.
- **Slack:** an app with the `chat:write`, `im:write`, `users:read` and
  `users:read.email` bot scopes. An admin installs it per organization.
- **OpenRouter:** an admin pastes the key per organization. It is not an
  environment variable.

## Deploy

```sh
docker build -t farmer .
docker run -p 3000:3000 --env-file .env farmer
```

The image runs the migrations and seeds the built-in tasks on each start. It
also runs the background jobs. To run the jobs in a separate process, see
[docs/domains/deployment.md](docs/domains/deployment.md).

Behind a reverse proxy, set `TRUSTED_IP_HEADER` so that the rate limits see the
real client address.

## Layout

| Path | Contents |
|---|---|
| `apps/web` | The web app (TanStack Start, React) and its Bun server |
| `apps/cli` | The `farmer` CLI |
| `apps/mobile` | The Android and iOS app (Expo) |
| `apps/push-relay` | The relay for mobile push notifications |
| `packages/core` | The services, the database schema and the jobs |
| `packages/api-client` | The typed client for `/api/v1` |
| `packages/push-crypto` | The encryption for push payloads |

## Development

```sh
bun run test         # all test suites, on an in-process Postgres
bun run check        # format and lint
bun run typecheck
```

[CLAUDE.md](CLAUDE.md) is the contributor guide. It has the commands, the
architecture and the rules. Each subsystem has a page in
[docs/domains](docs/domains).

## License

AGPLv3. See [LICENSE](LICENSE).
