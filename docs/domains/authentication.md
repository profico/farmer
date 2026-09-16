# Authentication

**Google is the only identity in production, and there is no login page there.** `emailAndPassword` is off, so there is no form to render and nothing to choose — "log in" is a redirect.

- **`routes/api/login.ts` is the sign-in surface.** A server route: it asks better-auth for the Google authorize URL and re-shapes that 200-plus-`Location` response into a real 302, copying the OAuth state/PKCE cookie across, so an unauthenticated document request reaches Google without the app hydrating.
- **`routes/login.tsx` stays a *page* route on purpose**, even though it renders almost never. Every `redirect({ to: "/login" })` and sign-out points at it, and a page route's `beforeLoad` runs both server-side and in the browser; `redirect({ href, reloadDocument: true })` turns either into the full-page hop `/api/login` needs.
- **Two cases render instead of redirecting.** `?error=…` — better-auth's `errorCallbackURL`, most usefully the single-org invite-only gate; that branch must not redirect, or an uninvited visitor bounces between `/login` and Google forever. And development, below.
- **`lib/dev-auth.ts` turns email + password back on off-production.** The gate is `NODE_ENV !== "production"` and deliberately **not** an opt-in env var, which could be copied from a `.env` onto a server. The Dockerfile and `apps/web`'s `start` script pin `NODE_ENV=production`; any other way of hosting the app must set it too. Downstream nothing is special-cased — the same `databaseHooks.user.create` hooks bootstrap the org and seed its tasks, and single-org mode's invite gate still applies to a password signup. The client learns it from `getPublicAppConfig().devAuth`, which also hides Preferences → Sign-in methods in production.
- **`/` never redirects, in any mode.** The landing page renders for everyone and its CTA resolves the destination (workspace / `/no-access` / `/login`).
- **`prompt: "select_account"` on the google provider is deliberate.** With no login screen there is nowhere to offer "use a different account".
- `session.freshAge: 0` — better-auth 403s `SESSION_NOT_FRESH` on unlink-account once a session is older than a day, and this app has no step-up re-auth flow, so integration disconnects would break.
- Invite context rides through as query params and is rebuilt into the Google `callbackURL`. `redirect` is attacker-supplied in principle, so `api/login.ts` accepts only a same-site absolute path (`/…` but not `//…`).


## Single-organization mode

Setting `SINGLE_ORG_SLUG=<slug>` turns a deployment into a one-workspace, invite-only instance. Unset (the default) is the normal multi-tenant product, and every code path below is a no-op. It is a slug rather than a boolean so "which organization?" is never implicit.

- **The switch is `packages/core/src/lib/single-org.ts`** — server-only. The client never reads the env var: `apps/web/src/server/config.ts` (`getPublicAppConfig`) hands it the mode plus the org's name/logo/slug.
- **The signup gate is a `databaseHooks.user.create.before` hook, not a screen.** Signing in with Google *is* the signup, and the user is created mid-OAuth-callback. The hook throws an `APIError` carrying a `code` (`INVITE_ONLY`) — that field is load-bearing, since better-auth's OAuth callback only turns a thrown error into a redirect back to `errorCallbackURL` when one is set, and otherwise surfaces a raw 403 mid-round-trip.
- **Bootstrap: the first person to sign in on an unclaimed instance creates the org and owns it.** The race is settled by the unique index on `organization.slug`, not a read-then-write check.
- **`allowUserToCreateOrganization: false` + `disableOrganizationDeletion: true`** are what actually close those endpoints; hiding the switcher's "New organization" item is presentation.
- **URLs keep the `/$orgSlug` prefix.** Tenancy stays an explicit parameter, matching the service-layer rule.
- **`/no-access` exists to break a redirect loop.** A signed-in user with no membership would otherwise bounce `/` → workspace → `/` forever. It lists their live invitations through a local server fn, because better-auth's `listUserInvitations` rejects any caller whose email isn't verified, and this app has no verification flow.

---

See also: `docs/domains/deployment.md` (the env vars), `apps/web/CLAUDE.md` (the login and no-access routes).
