# 0005 — The mobile app is one client for every server

**Status:** Accepted
**Date:** 2026-10-06

## Context

Farmer is self-hosted. There is no single public address: Profico runs one
server, and any operator can run another. The owner wants a native app for
iOS and Android. On iOS it must feel like iOS, and on Android like Material
You. It must serve every role: a member, a PM or team lead, and a workspace
admin.

Three facts about the server shaped the decision:

1. `api/v1` covers only a member's own time loop, which is what the CLI needs.
   Nothing for a PM, a team lead or an admin exists in it.
2. The sign-in methods are different on each server, and they change at
   runtime: Google, and each OIDC source in `instanceOAuthProvider`. Today
   only the browser can read the list (`getPublicAppConfig`).
3. A store app updates on its own schedule. A self-hosted server can be months
   older or newer than the app.

## Decision

**One store app, "Farmer: Time Tracking", that a person points at their own
server**, as `farmer login` does. Bundle id `com.profico.farmer`, scheme
`farmer://`, iOS 18 or later and Android 10 or later.

- **Expo and Expo Router in `apps/mobile`.** The controls are the system
  controls, through `@expo/ui` (SwiftUI and Jetpack Compose). The app uses the
  system fonts, and on Android 12 or later it uses the wallpaper colours. The
  farmer accent is the fallback colour. A file such as `screen.ios.tsx` exists
  only where the two platforms need a different design.
- **The app never imports `@farmer/core`.** It talks to the server only
  through `api/v1`, the same as the CLI. A shared `packages/api-client`, with
  types from `/api/v1/openapi.json`, serves both clients. The lint rule that
  keeps `apps/cli` off the server graph also covers both new packages.
- **The person gives the server address.** They type it, or they open a link
  or a QR code from the web app. The app checks the address with
  `GET /api/v1/meta` and keeps one server at a time.
- **`/meta` is the version contract.** It returns `apiVersion`,
  `minMobileVersion` and the server's sign-in methods. The app refuses a
  server that is too old, and the server can tell an old app to update. A
  mismatch then shows as one clear message, not as a 404 in the middle of a
  screen.
- **Sign-in uses `@better-auth/expo`.** The server adds the `expo()` plugin
  and puts `farmer://` in `trustedOrigins` in code, so an operator has nothing
  to configure. The app shows one native button for each method in `/meta`.
  Only the provider's own page opens, in the system auth sheet. The device
  flow, with a second client id `farmer-mobile` in `validateClient`, is the
  fallback for a provider that fails in the sheet.
- **`api/v1` grows to parity with the web app, and no private mobile API
  exists.** Each new route is a hand-written `apiRoute` that calls a service
  with an explicit `ctx` (ADR 0001 still applies). The Zod input schema moves
  next to its service, so the server function, the route and the OpenAPI
  document read one definition.
- **The server decides what a person can see.** `whoami` returns a list of
  capabilities for each workspace. The app shows a section only when the
  server gives the capability, and the route still checks the permission. The
  app does not copy `accessService.resolve` or the project roles.
- **Online only.** The server enforces the rules of a day: the 24 hours, the
  filing rules and the fill block. A queue on the phone would report a
  refusal hours later.

## Consequences

- Each new `api/v1` route needs a contract test against PGLite. A route that
  writes needs `recordAudit` and a line in `audit-coverage.test.ts`.
- The platform admin screens (`settings/instance/*` and the platform admins)
  and the Harvest import stay on the web. The app links to them.
- The app sends no analytics and no crash reports yet. Nothing in the app
  sends them. A later change must add an off switch in the app before it
  sends any.
- A change to the API contract needs a store build. EAS Update can send only
  a JS change that keeps the contract.
- The OIDC path of `@better-auth/expo` (`signIn.oauth2`) has no documented
  proof. A spike against a local server must pass before the sign-in screen
  is built on it.
- Spike, 6 October 2026: pass. A script drove `signIn.oauth2` against a mock
  OIDC provider, as `expoClient` does. The script is removed;
  `auth/mobile-contract.test.ts` and `auth/mobile-exchange.test.ts` are the
  proof now. The
  callback sent the browser to `farmer://auth-callback?cookie=<Set-Cookie>`
  (the plugin's own link, before the exchange below), and the session token
  from that cookie gave a 200 on `GET /api/v1/me` as a bearer. The Google
  start and proxy pass too; the Google callback runs through the same hook.
  The device flow stays the fallback. The tests cover the exchange: the
  code in the link, the one use, the wrong verifier, and a refused sign-in
  with a challenge.
- The plugin's `/expo-authorization-proxy` was an open redirect to any https
  URL. `auth/mobile-sign-in.ts` allows only Google and the origin of each
  OIDC source, so a source whose authorization endpoint is on a different
  host fails closed.
- **Resolved, 13 October 2026: the proxy needs a one-time token.** Anybody
  can start a flow and get a valid `state`, so a check of the state alone
  let an attacker send a victim to the proxy with the attacker's state. The
  start answer now holds `proxyToken` for the app. The proxy needs it,
  spends it once (it lives 5 minutes, and the server keeps only its hash),
  and compares the whole `authorizationURL` with the one that the server
  made for it. The token is not bound to one browser: a person who gets the
  full link can open it.
- **Resolved, 6 October 2026: the link carries a one-time code, not the
  session.** The session in the `farmer://` link could reach another Android
  app that claims the same scheme, and a self-hosted server cannot use
  verified https App Links. The fix is PKCE (RFC 7636, method S256). Before
  the browser opens, the app makes a random verifier and puts only its
  challenge in the `callbackURL` (`cc`). After the provider callback, a
  better-auth plugin (`auth/mobile-exchange.ts`) runs after `expo()`. It
  removes the cookie and `cc` from the redirect and adds a random code that
  lives 60 seconds. The server keeps only the hash of the code, with the
  challenge and the session id, in the `verification` table. The app sends
  the code and the verifier to `POST /api/auth/mobile/exchange` and gets the
  session token. A hostile app that reads the link has the code and the
  challenge, not the verifier, so it cannot redeem the code. The app also
  keeps its nonce (a forced sign-in) and reads a code and nothing else from
  the link. The design needed no fork of `@better-auth/expo`: the plugin
  keeps the query of the `callbackURL`, and plugin hooks run in list order.
  - **Limit:** a hostile app that holds the code can still burn it with a
    wrong verifier, so the person must start the sign-in again. It cannot
    make a session.
  - **The exchange is the only path.** The app is not published yet, and it
    ships with the server, so no app uses the old `cookie` link. A callback
    that ends at the app never carries a `cookie`: with no valid `cc` it
    carries `error=exchange_failed`. The hook covers every path where
    `expo()` adds a cookie (the callbacks, `/magic-link/verify` and
    `/verify-email`).
- The timer surfaces on the phone (the Live Activity and the ongoing Android
  notification) show the elapsed time only. Stop opens the confirm form with
  the snapped figure, as ADR 0003 requires. Nothing confirms an entry from the
  lock screen.
