# Audit log

Who changed what in a workspace, and every sign-in of its people. Admins only,
on the Audit log page (the main sidebar, under Reports). Issue #112; the decisions and their reasons are in
`docs/plans/audit-log.md`.

## The pieces

| File | What it is |
|---|---|
| `packages/core/src/lib/audit.ts` | `AUDIT_KINDS` (every kind, its category and its sentence), `AUDIT_VIA`, the retention choices. Pure, so the page imports it |
| `packages/core/src/db/schema/audit.ts` | `audit_event`. The header says why there is no foreign key to `user` |
| `packages/core/drizzle/0073_audit_event_append_only.sql` | The trigger that refuses an `UPDATE` |
| `packages/core/src/services/audit.ts` | **The write seam**: `recordAudit`, `recordSecurityEvent`, `diffFields`. Also `auditService` (list, export, retention) and `sweepAuditLog` |
| `packages/core/src/auth/audit-hooks.ts` | What the better-auth hooks in `auth/index.ts` need: the caller, the client address, the failed sign-in |
| `packages/core/src/jobs/audit-sweep.ts` | The daily retention sweep |
| `packages/core/src/services/audit-coverage.test.ts` | **The completeness check.** Every function of an audited service is recorded or exempt with a reason |
| `apps/web/src/routes/$orgSlug/audit-log.tsx` | The page |

## The rule that holds it up

**`recordAudit(ctx, entry)` writes one row and never throws**, the sibling of
`emitEvent` (`services/events.ts`). It writes on `ctxDb(ctx)`, so inside
`withCtxTx` the row commits or rolls back with the change. A service that runs
its write in a plain `db.transaction` records after the commit.

```ts
await recordAudit(ctx, {
  kind: "project.updated",
  target: { type: "project", id: row.id, label: row.name },
  changes: diffFields(before, after, ["name", "hourlyPrice", "openToOrg"]),
});
```

- **Record after the write succeeded**, never before.
- **Skip an update that changed nothing.** `diffFields` answers null then.
- **Name the fields the form edits.** `updatedAt` is not a change.
- **A secret is redacted by its name**: a field that ends in `secret`,
  `token`, `key` or `password`. Name a secret field so, or leave it out.

## Who did it

`Ctx.actor` (`services/types.ts`) is set at each entry point: `web` in
`requireOrgContext`, `api` / `cli` / `api_token` / `mcp` in
`server/api-auth.ts`, `assistant` in the assistant's stream route. A Ctx with
no actor is a job, and reads as `system`.

- **Impersonation**: the actor is the person whose session it is, and
  `impersonator` is the platform admin, from `session.impersonatedBy`.
- **The client address** follows the rate limits' rule
  (`lib/client-address.ts`), not better-auth's `session.ipAddress`, which
  trusts the first `X-Forwarded-For` entry that a caller writes.

## Security events

`recordSecurityEvent` writes one row per workspace the person is a member of
now, in one statement. An API token bound to one workspace writes to that one.

| Event | Where |
|---|---|
| `auth.signed_in` | `databaseHooks.session.create.after`. Not for an impersonated session. `cli` for the device flow |
| `auth.sign_in_failed` | `hooks.after` on `/sign-in/email`. **Only for an address that has an account** |
| `auth.signed_out` | `hooks.before` on `/sign-out`, while the session is readable |
| `account.linked` | `databaseHooks.account.create.after`, not the first account of a signup, not an integration grant |
| `account.unlinked` | `accountService.unlinkGoogle` |
| `session.revoked` | `sessionsService.revoke` |
| `api_token.created` / `.revoked` | `apiTokensService` |
| `impersonation.started` / `.stopped` | `routes/api/auth/$.ts`, beside the PostHog ledger |

Member management is better-auth's, so `member.invited`, `.invitation_cancelled`,
`.removed` and `.role_changed` come from its `organizationHooks`. The hooks do
not say who called; `getCurrentAuthContext()` from `@better-auth/core/context`
does.

`member.joined` comes from `memberJoined` (`services/member-joined.ts`), which
every way in runs one time: an invitation accepted, a member added, and a
Harvest import's pending claim accepted (`importClaimsService.accept`).

## What is not recorded

- A person's own time and preferences. Time is recorded only for the PM
  absence writes, when the person is somebody else.
- The automation engines, for the reason `docs/domains/webhooks.md` gives.
- Reads, except an export of this log.
- `github` and `google-calendar` accounts: they are integration grants, not
  sign-in methods.

`audit-coverage.test.ts` holds the reason for each exempt function.

## Integrity and retention

- **No `UPDATE`, ever.** The trigger refuses it. A later erasure feature that
  pseudonymizes names needs its own exception (plan, section 6).
- **Retention** is `org_settings.audit_retention_days`: 90, 365 (default), 730
  or 2555. `jobs/audit-sweep.ts` deletes older rows daily
  (`AUDIT_SWEEP_ENABLED`, `AUDIT_SWEEP_INTERVAL_MINUTES`). It is off under
  `vite dev`, because a local `.env` can point at a shared database.
- **The export** is at most a year and 10,000 rows. A cell that starts with
  `=`, `+`, `-` or `@` gets a leading quote, so a spreadsheet does not run a
  name as a formula. The export records itself.

## Adding an audited write

1. A kind in `AUDIT_KINDS` (`lib/audit.ts`), with its category and sentence.
2. The `recordAudit` call after the write, with `diffFields` for an update.
3. The function in `recorded` in `audit-coverage.test.ts`. A new function
   that is not a change goes in `exempt` with its reason, or in `reads`.
