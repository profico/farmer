# The mobile app: the implementation plan

The decisions are in `docs/adr/0005-native-mobile-app.md` and
`docs/adr/0006-push-relay.md`. This file gives the order of the work. Each
phase ends with a green `bun run check`, `bun run typecheck` and
`bun run test`, and with a draft PR.

## Phase 0: the sign-in spike

1. Add the `expo()` plugin and `farmer://` to `trustedOrigins` on a local
   server.
2. Make a minimal Expo app that signs in with Google and with one OIDC source
   through `signIn.oauth2`.
3. Record the result in ADR 0005. If the OIDC path fails, make the device flow
   (`farmer-mobile`) the main method and the Expo sign-in the second one.

## Phase 1: the contract

1. Extend `GET /api/v1/meta` with `apiVersion`, `minMobileVersion` and the
   sign-in methods (`signInProviders()` and a password flag).
2. Add `farmer-mobile` to `validateClient`.
3. Add the capabilities for each workspace to `whoami`.
4. Make `packages/api-client` from the CLI's client, with types from the
   OpenAPI document. Move the CLI onto it.

## Phase 2: API parity

1. Move each Zod input schema next to its service, so that the server function
   and the route share it.
2. Add the routes, domain by domain, in this order:
   - the member's screens: preferences, schedule, recurring blocks,
     integrations, holidays, project detail, reports and Rewind;
   - the PM and team lead screens: project settings, the team, clients and
     people;
   - the workspace admin screens: the organization, tasks, the hour fund,
     reminders, workspace integrations, webhooks, members, the audit log and
     the reports for everyone;
   - the assistant stream.
3. For each route, add a contract test, an OpenAPI entry, and a
   `recordAudit` call with an `audit-coverage` line when the route writes.

## Phase 3: the app

1. Create `apps/mobile` (Expo, Expo Router, `@expo/ui`, `expo-secure-store`),
   with the lint boundary and the `.env` rules of the monorepo.
2. Build the screens for the server address (typed, link, QR code), the
   version check and the sign-in.
3. Build the four tabs (Time, Projects, Reports, More/Settings), the workspace
   switcher, and the sections that the capabilities control.
4. Build the screens in the order of phase 2. Add the assistant last.
5. Connect the analytics to the server's PostHog and the crash reports to the
   Profico project, with the switch in More, Privacy.
6. Add the Maestro flows for the sign-in, logging time and the stopwatch, and
   set up EAS Build, Submit and Workflows.

## Phase 4: push and the timer surfaces

1. Build `apps/push-relay` (`Bun.serve()`, `bun:sqlite`) with registration,
   forwarding and a rate limit for each device. Add its image to CI and deploy
   it on Coolify at `push.farmer.profi.co`.
2. Add the `mobile_device` table, the routes to register and remove a device,
   and the native push channel in `services/notify.ts`.
3. Add the Slack replacement and its preference, with the fallback to Slack.
4. Add the iOS Live Activity and the ongoing Android notification. They start
   from the app's own actions and get remote updates through the relay.
5. Document the push setting and the relay in `docs/domains/deployment.md`,
   and add a `docs/domains/mobile.md`.
