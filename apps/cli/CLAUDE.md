# apps/cli

`@farmer/cli` — `farmer`, a command-line tool to log and read your own time. A
real CLI over a REST API, not an MCP client: tool results are shaped for a model
and change with the prompt, and a binary installed on somebody's laptop cannot
follow them. The spec and the owner's decisions are issue #36;
`apps/cli/README.md` is the user-facing half. Read the root `CLAUDE.md` first for
the commands and the lint rules.

## Rules

- **Login is the device authorization flow** — better-auth's `deviceAuthorization` plugin, client id `farmer-cli` (the mobile app also uses `farmer-mobile`; `DEVICE_CLIENT_IDS` lists both, and `/device` names the client from `server/device.ts`), 10-minute codes. `farmer login` shows a code and opens `/device` (`routes/device.tsx`), where the signed-in person approves it. **Opening the page is what binds the code to that person** (better-auth's `GET /device` claims it, and approve refuses an unclaimed code), so the page makes that call on mount, client-side, before Approve can work. It reads `user_code` from the raw query string, because the router `JSON.parse`s search values and `2E345678` comes back a number.
- **The token is a better-auth session token, and the `bearer` plugin stays off.** With that plugin every server function would accept an `Authorization` header and `resolveMcpOrgContext`'s credential order would stop being safe. `resolveCliUser` (`server/api-auth.ts`) is the only reader: `internalAdapter.findSession`, then the sliding refresh `getSession` does, copied by hand because `findSession` does not slide — without it a token used every day dies seven days after login. The CLI keeps the token in the OS keyring (`Bun.secrets`), or a 0600 `credentials.json` where there is none.
- **`FARMER_TOKEN` is the other credential** — a personal API token for a script, which wins over the stored login (`connect`, `session.ts`). A session built from it never deletes the stored login on a 401, never writes the config (`saveConfig` returns early, because a token bound to one workspace would replace the cached list), and refuses `farmer org use`; `farmer logout` does not revoke it. The server tells the two tokens apart by the `fmr_` prefix. See `docs/domains/api-tokens.md`.
- **The server side of the CLI's API is `apps/web/src/server/api-route.ts`.** Its rules (the pipeline order, the PostHog report, the cookie on a write, the error mapping) are in `apps/web/CLAUDE.md` and `docs/domains/rest-api.md`. **Never add CORS headers to `api/v1`.** **Throw a subclass of `Error` for anything that is not a sentence for the person**, because the pipeline sends the message of a bare `Error` to the terminal.
- **A row number is an address the client recomputes, not state it keeps.** The `#` column of `today`, `week` and `ls` (`render.ts`) numbers the entries INSIDE their day, and `edit`/`rm` resolve it by reading that day again (`selectEntry`, `pick.ts`) — there is no "last list" file, so two terminals and a stale scrollback cannot disagree about what `3` is. Two things hold it up and both are load-bearing: `listRange` orders by `(date, createdAt, id)`, the id breaking a tie that `copy day` makes routinely, and `sortEntries` is the ONE sort both the table and the selection use. A number is 1-2 digits, an id prefix is longer — a day tops out at 96 rows (24 hours in 15-minute steps), and nobody types one character of an id.
- **Routes answer projections, never rows** (`src/api/`). A new column must not become a field an installed binary depends on. Raise `MIN_CLI_VERSION` (`api/meta.ts`) when a shape changes in a way an old binary cannot read; `GET /api/v1/meta` hands it out unauthenticated and the pipeline enforces it on every request.
- **Repository defaults are ids in a `.farmer.jsonc` the repository commits** (`apps/cli/src/repository-defaults.ts`, `farmer init`; the design is ADR 0002). The nearest file up to the git root names the `org` slug every command runs in, and the `project` and `task` ids `farmer log` and `farmer start` use when `-p`/`-t` are missing — never codes or names, which drift onto another project silently. A flag wins and `--org` turns the file off; each value taken is announced on stderr; a broken or stale file stops the command rather than falling back to the personal default organization. The MCP server cannot read the file, so its `instructions` (`routes/api/mcp/$orgSlug.ts`) teach the agent the same rules, and `list_projects` returns `code` for it. `farmer init` suggests projects from the git remote through `api/v1/orgs/$orgSlug/repository-projects` — a route, not a field on `ApiProject`, so an older server's 404 means "no suggestion".
- **`CliError` carries the `status` and the `code` of the failure that made it** (`src/errors.ts`, set in `ApiClient.#failure`). A status alone cannot be branched on: `CLI_ENABLED=false` answers a JSON 404 with a code for every organization route, so only a 404 WITHOUT a code means "this server is older than this binary". `commands/timer.ts` is the first caller, and the pattern is what a command for any new route should use instead of raising `MIN_CLI_VERSION`.
- **The stopwatch is one row on the server, not a file on the laptop** (`farmer start`, `continue`, `pause`, `resume`, `stop`, `timer`, `timer discard`; `docs/domains/timer.md`). It is keyed on the PERSON, so `farmer start` in a terminal is stopped by the Stop button in a browser, and a timer running in another workspace is reported rather than hidden. Nothing is logged until `farmer stop`, and the measured time is snapped to the 15-minute step every entry keeps. `pause` and `resume` post to routes that answer an already-held or already-running timer with the row as it stands rather than an error, so two surfaces driving one clock cannot disagree. `--head-start` is read by `parseHeadStart` in `@farmer/core/lib/time`, the one the web dialog and the schema use. On a continued entry `farmer stop --duration` ADDS to what the entry held (`stoppedDuration`), because `confirm` writes the figure as the entry's total; `-p none` sends `null` and an emptied note sends `""`, because an absent field keeps the continued entry's. `farmer continue` refuses a work-time block or time off locally (`whyNotContinued`, through `selectEntry`'s `refuse`), and its picker leaves them out.
- **The CLI's import boundary is linted.** At runtime `apps/cli` may import only `@farmer/core/schema`, `/lib/time`, `/lib/search` and `/api`; `import type` from services is fine. The `no-restricted-imports` override in `oxlint.config.ts` fails the build on a runtime `@farmer/core/services|db|auth|jobs` import — that is what keeps the server graph out of a binary anyone can download.
- **Install and release are in `docs/domains/cli-distribution.md`.** Read it before you change the install scripts, `farmer update` or the release workflow. The rules:
  - The binaries live on GitHub Releases, and the binary never passes through the server. The install scripts verify the binary against `SHA256SUMS` and fail closed.
  - `farmer update` runs the server's install script over the running binary. Do not add a second copy of the asset choice and the checksum logic.
  - **Releasing is a tag.** Bump `apps/cli/package.json` and push `cli-vX.Y.Z`.
  - The workflow re-signs the macOS binaries on a Mac runner. Do not "simplify" the workflow back to one Linux job.
  - The musl binaries need `libstdc++` and `libgcc`.
- **Signed-in devices is the lost-laptop answer.** Preferences lists the person's sessions (`sessionsService`), labels a CLI one from `CLI_USER_AGENT_PREFIX` in its user agent, and deleting the row is the revocation — the CLI's next request gets a 401 and drops its token. Revoking the session you are using is refused: that is signing out.
- **`CLI_ENABLED=false`** (env, default on, `lib/cli-flag.ts`) 404s `api/v1/orgs/*`, `me`, `session`, the device endpoints (gated in `routes/api/auth/$.ts`), `/device` and `/cli`; `meta` answers `cliEnabled: false`.

## Testing

`bun test` from `apps/cli` covers the duration and date parsers, the table
format, the device flow and the API client against an injected `fetch`.
Everything testable about the CLI's **API** that does not need a route — the
membership check, the projections, the version compare, the flag — lives in
`packages/core`. The guards of the real route handlers are tested in
`apps/web/src/server/*.test.ts`.

## See also

- `packages/core/CLAUDE.md` — `src/api/` (the projections), `src/schema/` (the inputs).
- `apps/web/CLAUDE.md` — `server/api-route.ts`, `server/api-auth.ts`, `routes/device.tsx`, `routes/cli/`.
- `docs/adr/0002-repository-defaults-file.md` — the `.farmer.jsonc` design.
- `docs/adr/0003-stopwatch-is-an-input-method.md` and `docs/domains/timer.md` — the stopwatch.
- `docs/domains/deployment.md` — `CLI_ENABLED` and the other env flags.
- `docs/domains/api-tokens.md` — the API tokens behind `FARMER_TOKEN`.
