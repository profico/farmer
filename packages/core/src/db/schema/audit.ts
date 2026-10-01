// The audit log: what was changed in an organization, by whom, and through
// which door. See `docs/domains/audit-log.md`.
//
// **Append-only.** Nothing in the app updates a row, and a trigger (migration
// `0073_audit_event_append_only`) refuses an UPDATE from anybody, so a bug in a
// later change cannot rewrite history either. Rows leave in two ways only: the
// retention sweep (`jobs/audit-sweep.ts`) and the cascade when the organization
// itself is deleted.
//
// **No foreign key to `user`.** A person who leaves still has to read as a
// person in last year's log, and `on delete set null` would be an UPDATE that
// the trigger refuses. So the ids are plain text and each row carries the
// names as they were when it was written: `actor_name`, `impersonator_name`,
// `target_label`.
//
// **A security event is one row per workspace of the person**, written at the
// time (see `recordSecurityEvent`). A sign-in is not about any one workspace,
// and fanning out at write time means an admin keeps the history of somebody
// who has since left, and never sees what happened before they joined.

import { sql } from "drizzle-orm";
import {
	check,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

import type { AuditChanges } from "../../lib/audit";
import type { JsonRecord } from "../../lib/json";
import { organization } from "./auth";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

export const auditEvent = pgTable(
	"audit_event",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		occurredAt: ts("occurred_at").notNull().defaultNow(),
		/** A key of `AUDIT_KINDS` (`lib/audit.ts`). */
		kind: text("kind").notNull(),
		/** `change` or `security`, copied from the kind so the page can filter on
		 *  an index rather than on a list of kinds. */
		category: text("category").notNull(),

		/** Who did it. Null for a job, and for a failed sign-in, where the only
		 *  person known is the one the address belongs to (`subject_user_id`). */
		actorUserId: text("actor_user_id"),
		actorName: text("actor_name"),
		/** A platform admin acting as `actor_user_id` through impersonation. The
		 *  actor is the person whose session it was; this is who was driving. */
		impersonatorUserId: text("impersonator_user_id"),
		impersonatorName: text("impersonator_name"),
		/** `AUDIT_VIA` in `lib/audit.ts`. */
		via: text("via").notNull(),
		/** The API token a request presented, when `via` is `api_token`. No
		 *  foreign key: a revoked token is deleted, and its row here stays. */
		apiTokenId: uuid("api_token_id"),
		ip: text("ip"),
		userAgent: text("user_agent"),

		/** What was changed: `project`, `member`, `webhook`, ... Null for an event
		 *  about the workspace itself or about the actor's own session. */
		targetType: text("target_type"),
		targetId: text("target_id"),
		/** The target's name when the row was written, so a renamed or deleted
		 *  target still reads correctly. */
		targetLabel: text("target_label"),
		/** The person the event is about, when there is one: the member whose
		 *  role changed, the person who signed in. What "everything about Ana"
		 *  filters on. */
		subjectUserId: text("subject_user_id"),

		/** Field → { from, to }, for an update. Secrets are already redacted. */
		changes: jsonb("changes").$type<AuditChanges>(),
		/** Anything else worth keeping: counts, a reason, a method name. */
		details: jsonb("details").$type<JsonRecord>(),
	},
	(t) => [
		index("audit_event_org_time_idx").on(t.organizationId, t.occurredAt),
		index("audit_event_org_actor_idx").on(
			t.organizationId,
			t.actorUserId,
			t.occurredAt,
		),
		index("audit_event_org_subject_idx").on(
			t.organizationId,
			t.subjectUserId,
			t.occurredAt,
		),
		index("audit_event_org_target_idx").on(
			t.organizationId,
			t.targetType,
			t.targetId,
		),
		// The failed sign-in limit (`recordFailedSignIn`) looks up a person
		// without an organization. The indexes above lead with the
		// organization, and Postgres 17 has no skip scan, so without this
		// index each failed password reads the whole index.
		index("audit_event_failed_sign_in_idx")
			.on(t.subjectUserId, t.occurredAt)
			.where(sql`${t.kind} = 'auth.sign_in_failed'`),
		check(
			"audit_event_category_check",
			sql`${t.category} in ('change', 'security')`,
		),
		check(
			"audit_event_via_check",
			sql`${t.via} in ('web', 'api', 'api_token', 'cli', 'mcp', 'assistant', 'system')`,
		),
	],
);
