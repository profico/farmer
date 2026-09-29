# Plan: audit log

Status: sections 1 to 7 are implemented on the branch `feat/audit-log`
(issue #112). Section 8 lists what is left for later.

This file is the design record. It keeps the reasons behind the rules and the
owner's decisions. How the finished feature works is in
`docs/domains/audit-log.md`.

Issue #112 asks for "audit logs for organisation changes, visible to all
administrators". In the discussion before the work started, the owner decided:

1. **Only administrators see the log.** Not Team Leads, not for their own
   people.
2. **Security events go in the log too**: sign-in, a failed sign-in, sign-out,
   a revoked session, a linked or unlinked sign-in method, API tokens, and
   impersonation.
3. **Erasure (GDPR Article 17) is answered by the design, not by a feature.**
   Farmer has no account deletion today, so nothing is built for it. The rules
   in section 6 make sure that a later deletion feature has an answer.

## 1. What is recorded

A change to the **organization**: people and roles, clients, projects,
assignments, tasks, hour funds, holidays, the workspace settings, reminders,
the assistant settings, webhooks, GitHub and Slack connections, and Harvest
imports. `lib/audit.ts` is the full list (`AUDIT_KINDS`).

Time is recorded only when a person changes the time of **another** person.
Today that is the three PM absence writes. Somebody who edits their own day
does not change the organization, and an admin who changes the hours of
somebody else is the most important row in the log.

Not recorded:

- A person's own time and own preferences (working hours, filing rules,
  recurring blocks, hidden tasks, integration switches).
- The automation engines. A sweep recalculates; it does not decide. This is
  the rule `docs/domains/webhooks.md` already gives for outbound events.
- Reads. The one exception is an export of the log itself.

## 2. Who did it

Each row names the actor, and also the door the request came through:

| `via` | Set by |
|---|---|
| `web` | `requireOrgContext` (`server/auth.ts`), so every server function |
| `api` | `resolveApiOrgContext` (the cookie-authed REST reads) |
| `cli` | `resolveCliOrgContext`, for a device-flow session |
| `api_token` | `resolveCliOrgContext`, for a personal API token, with its id |
| `mcp` | `resolveMcpOrgContext` |
| `assistant` | the Ctx the assistant's tools run with |
| `system` | a Ctx with no actor: a job or a script |

**Impersonation.** When a platform admin impersonates a person, the session
belongs to the person and `session.impersonatedBy` names the admin. The row
names the person as the actor and the admin as `impersonator`, and the page
says "impersonated by". The start and the stop are rows of their own.

The actor rides on the Ctx as a plain optional key (`Ctx.actor`), not in the
memo slot, so a Ctx that is spread or rebuilt keeps it. `withCtxTx` copies it.

## 3. How a row is written

`recordAudit(ctx, entry)` in `services/audit.ts`, the sibling of `emitEvent`:

- One insert, on `ctxDb(ctx)`, so it joins the caller's transaction when
  there is one.
- **Never throws.** The change has already been made, and an audit failure
  must not undo it.
- **The entry is a value, not a builder.** `emitEvent` takes a function
  because most organizations have no webhook endpoint. Every organization has
  an audit log, so a builder would save nothing.
- **The actor's name is a subquery inside the insert**, so it costs no second
  round trip.
- **A field diff**, `{ field: { from, to } }`, from `diffFields`. The caller
  names the fields a form edits, so `updatedAt` never shows as a change. An
  update that changed nothing writes no row.
- **A secret is redacted by name.** A field whose name ends in `secret`,
  `token`, `key` or `password` is written as `[redacted]`. The log says that
  it changed, not what to.
- **A label snapshot.** The target's name at the time is stored on the row, so
  a renamed or deleted project still reads correctly.

## 4. Security events

better-auth owns sign-in, sign-out and member management, so these rows come
from its hooks, not from our services. `recordSecurityEvent` writes one row
for **each workspace the person is a member of at that moment**:

- It is one statement, however many workspaces there are.
- An admin keeps the history of somebody who has since left.
- A workspace never sees what happened before the person joined it.
- An API token bound to one workspace is recorded in that workspace only.

**A failed sign-in is recorded only for an address that has an account.** A
row for an unknown address would let anybody fill a workspace's log from the
login form.

## 5. Integrity and retention

- **Append-only.** The service has no update and no delete. A trigger
  (migration `0073`) refuses an `UPDATE` from anybody. A `DELETE` is allowed,
  because the retention sweep and the organization's own cascade are the two
  ways a row leaves. The trigger stops a bug, not a database administrator.
- **No foreign key to `user`.** `on delete set null` would be an `UPDATE`, and
  a person who has left must still read as a person.
- **Retention is a workspace setting**: 90 days, 1 year (the default), 2 years
  or 7 years (`org_settings.audit_retention_days`). A closed list, so the
  sweep can never be asked to keep a row for a day or for ever. A change of
  retention is itself a row.
- **`jobs/audit-sweep.ts`** deletes older rows once a day, in one statement.

## 6. Erasure

A person can ask a company to delete their personal data. The log keeps
personal data on purpose, so the design limits what it keeps:

- A row stores the actor's user id and a **name snapshot**. It stores an email
  only when the change is about an email (an invitation).
- **The retention limit is the main protection.** A security and
  accountability log that deletes its rows after a stated period is a
  legitimate interest under the GDPR.
- **If Farmer adds account deletion, pseudonymize, do not delete.** Replace
  the name snapshots with "Deleted user" and keep the id. The log then still
  shows that one person made five changes, but not who. Deleting the rows
  would damage the record the admins trust. That update is the one place the
  trigger in section 5 must allow, through a setting only that code sets.

## 7. The page

The Audit log page (`routes/$orgSlug/audit-log.tsx`), admins only. It is a
row in the main sidebar under Reports, not a settings page: an admin reads
the log, and does not configure it.

- Filters: Everything / Changes / Security, a person (the actor OR the person
  the row is about), and a date range in the workspace's timezone.
- 50 rows a page, newest first, with a cursor on `(occurred_at, id)` so rows
  written in the same millisecond are not skipped or repeated.
- Each row opens to show the diff, the details, the IP address and the
  browser.
- **Export CSV**: the current filter, at most one year and 10,000 rows. A
  cell that a spreadsheet would read as a formula gets a leading quote. The
  export is recorded in the log.
- The retention setting.

## 8. Later

- `GET /api/v1/orgs/:slug/audit-log`, for an admin's API token.
- An `audit.*` webhook kind, to send the log to a SIEM. Add it when a customer
  asks.
- A "History" tab on a project and on a person, from the same table
  (`audit_event_org_target_idx` is already there for it).
- An instance-level log for the platform admins: instance settings, the
  platform admin role. These rows have no organization, so they need their
  own table or a nullable `organization_id`.
