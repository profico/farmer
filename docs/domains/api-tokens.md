# API tokens

A long-lived credential a person makes for a script: a cron job, a CI step, a
spreadsheet that pulls last month. The CLI's device flow stays what it is — a
session a person approves in a browser — and the API reference (`/api-docs`)
recommends a token for anything that runs without a person.

## The pieces

| File | What it is |
|---|---|
| `packages/core/src/api/tokens.ts` | `API_TOKEN_PREFIX` (`fmr_`), `API_TOKEN_SCOPES` and `isApiToken`. Runtime-safe, so the web auth path can branch on a token without the server graph |
| `packages/core/src/db/schema/api-tokens.ts` | `api_token`. The header says why each column is what it is |
| `packages/core/src/schema/api-tokens.ts` | `createApiTokenInput` (name, scope, workspace, lifetime) and `apiTokenIdInput` |
| `packages/core/src/services/api-tokens.service.ts` | `listMine`, `create`, `revoke`, `authenticate`, `revokePresented` |
| `apps/web/src/server/api-tokens.ts` | The three server functions, behind `orgMiddleware` |
| `apps/web/src/components/api-tokens-settings.tsx` | Preferences → API tokens: the list, Revoke, and the dialog that shows a new token once |
| `apps/web/src/server/api-auth.ts` | `resolveCliUser` — the one reader of both kinds of bearer token |
| `apps/web/src/server/api-route.ts` | `serve` — refuses a write from a read-only token |
| `apps/cli/src/session.ts` | `FARMER_TOKEN` |

## The rules

- **A token acts as its owner and belongs to the person, not the workspace**,
  like a session. It is not a service account: it sees what its owner sees,
  and it stops at the same membership check a device-flow token does
  (`orgContextService.resolveBySlug`). An ex-member's token is a 401 in that
  workspace; a deleted user's tokens go with the user (`on delete cascade`).
- **Only the SHA-256 of the token is stored.** The token is 32 random bytes,
  so a slow hash would protect nothing. The dialog shows the token once; the
  list shows the last four characters (`hint`).
- **Scope is `read` or `write`, and `serve` enforces it** after authentication
  and before the per-user limits: a read-only token on any non-GET route under
  `api/v1/orgs/*` gets 403 `forbidden` with a sentence that says why. The one
  exception is `DELETE /api/v1/session`, which `userApiRoute` passes with
  `writes = false` — a read-only token may always revoke itself. A new write
  route needs nothing: the rule reads the HTTP method.
  The HTTP method alone decides what "read" means. `GET …/time-entries` still
  performs the fill-block writes of `listRange` (it writes on read, see the
  root `CLAUDE.md`). A read-only token is therefore not free of side effects.
- **A token can be bound to one workspace** ("Only this workspace", the
  default), stored as `organization_id`. A bound token naming another slug is
  refused like an unknown slug (`resolveCliOrgContext` returns null → 401), and
  `GET /me` lists only the bound workspace. Null means every workspace the
  owner is in.
- **Expiry is a closed list** — 30, 90 or 365 days, or never (`API_TOKEN_LIFETIMES`).
  An expired token is a 401 and stays in the list marked Expired, so a person
  whose script stopped can see why. A revoked token is deleted.
- **`last_used_at` moves at most once a minute**, through a conditional update
  in SQL, so a script in a loop does not write a row per request and two
  requests that arrive together write once. A failed update is logged and the
  request still succeeds.
- **At most 50 tokens per person** (`MAX_API_TOKENS_PER_USER`).
- **Tokens ride the CLI's switch.** `CLI_ENABLED=false` 404s the whole REST API,
  so Preferences hides the section and its loader skips the query.
- **The two credentials are told apart by prefix, not by lookup order.**
  `resolveCliUser` sends an `fmr_` token to `apiTokensService.authenticate` and
  anything else to better-auth's session table. The `bearer` plugin stays off
  (see `apps/cli/CLAUDE.md`). PostHog's `api_request` event records which kind
  answered as `api_credential` (`session`, `api_token` or `cookie`).

## The routes for the mobile app

The mobile app shows Signed-in devices and API tokens, as Preferences does.
Each route calls the service that the
server function calls, so the web app and the app read one definition.

| Route | Service |
|---|---|
| `GET /api/v1/me/sessions` | `sessionsService.listMine` |
| `DELETE /api/v1/me/sessions/$id` | `sessionsService.revoke` |
| `GET`, `POST /api/v1/orgs/$orgSlug/api-tokens` | `apiTokensService.listMine`, `create` |
| `DELETE /api/v1/orgs/$orgSlug/api-tokens/$id` | `apiTokensService.revoke` |

- **An API token cannot call them.** `requireSignIn` in `server/api-route.ts`
  answers 403. A token that could make a token would turn one leaked key into
  a lasting one, and a revoke of the first would not end it. A sign-in session
  of the CLI or the app may call them.
- **The current session comes from the bearer token.** `currentIdFor` names
  the row, and `revoke` refuses it with 422. The client signs out with
  `DELETE /api/v1/session` and clears its own token. A cookie read has no
  token, so no row is current.
- A session of the app records `farmer-mobile/<version> (<platform> <os>)`
  and the list names it "Farmer app on Android" or "Farmer app on iOS".

## Routes that refuse a token

A token is a long-lived key for a script. A leaked key of an admin must not
reach the credentials and the settings of the workspace. A route spec sets
`signInOnly: true`, and `apiRoute` calls `requireSignIn` before it parses the
input. The route answers 403 for an API token. A browser session, the CLI's
device-flow session and the session of the mobile app pass.

- **Webhooks**, each route. An endpoint receives every member's time entries.
- **Audit log**: the list, the export and the retention.
- **Workspace integrations** (GitHub, Slack), each route.
- **People** and **invitations**, each route.
- **Settings**: the policy, the reminders, the organization `PATCH`, the
  integration settings `PATCH`, the holidays `PATCH` and the disconnect of
  GitHub or Google Calendar.
- **The assistant settings**: the `POST`, `PATCH` and `DELETE`. The `GET` stays
  open to a member, as in the web app.

The CLI calls none of these routes. A new route of this kind sets
`signInOnly`. `server/api-route-gate.test.ts` lists the routes above.

## The API reference

`/api-docs` (Scalar, `components/site/api-reference.tsx`) offers two schemes in
its Authentication menu. `bearer` takes a token. `session` is there only for a
signed-in reader with a workspace: the page loads
`/api/v1/openapi.json?org=<slug>`, and `buildOpenApiDocument({ orgSlug })` adds
the scheme, makes it the first choice and fills in `orgSlug`. The plain
document has no `session` scheme, so the cached copy that tools download stays
token-only.

The scheme is the header `x-farmer-session: 1`, and `customFetch` sends the
cookie with it and drops any `Authorization`. With `bearer` chosen, it sends no
cookie and drops the header, so a request with no token gets the 401 a script
would. The server side is `provesSameOrigin` in `server/api-route.ts`, and
`apps/cli/CLAUDE.md` says why a write with the cookie is not CSRF.

## The CLI

`FARMER_TOKEN` wins over the stored login for the command, the way
`FARMER_URL` wins over the last server; with no stored server, `FARMER_URL` is
required. A session built from it:

- never deletes the stored login when the server refuses the token, and says
  `FARMER_TOKEN` was refused rather than "run `farmer login`";
- never writes the config (`saveConfig` is a no-op), because a bound token
  sees one workspace and must not replace the person's cached list and default;
- refuses `farmer org use`, since there is nothing to save the default into.

`farmer logout` leaves `FARMER_TOKEN` alone and says so: a token in the
environment usually belongs to a script that shares it.

## Not covered

- **MCP does not accept an API token.** MCP clients authenticate through the
  OAuth provider (`docs/domains/mcp-server.md`); a token there would be a second
  credential order to keep safe.
- **An admin cannot see or revoke another member's tokens.** Removing the
  member from the workspace is the lever: their tokens stop answering for it.
- The two cookie-authed reads (`api/v1/projects`, `api/v1/time-entries`) do not
  take a token. The org-scoped routes cover the same reads.
