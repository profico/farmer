// The audit log's vocabulary: which kinds of event exist, how each one reads,
// and how a request says where it came from.
//
// Pure and import-free, because three places read it: the service that writes
// a row, the settings page that draws one, and the CSV export. The page runs
// in the browser, so nothing here may reach the server graph.
//
// See `docs/domains/audit-log.md` for what is recorded and what is not.

/** How a change reached the app. `system` is a job or a script, with nobody
 *  behind the request. */
export const AUDIT_VIA = [
	"web",
	"api",
	"api_token",
	"cli",
	"mcp",
	"assistant",
	"system",
] as const;
export type AuditVia = (typeof AUDIT_VIA)[number];

export const AUDIT_VIA_LABELS = {
	web: "Web",
	api: "API",
	api_token: "API token",
	cli: "CLI",
	mcp: "MCP",
	assistant: "Assistant",
	system: "System",
} as const satisfies Record<AuditVia, string>;

/** The label of a stored `via`, or the raw value for one this build does
 *  not know. */
export const auditViaLabel = (via: string): string => {
	const known = AUDIT_VIA.find((candidate) => candidate === via);
	return known ? AUDIT_VIA_LABELS[known] : via;
};

/** `change` is something an administrator (or a lead) did to the workspace.
 *  `security` is something that happened to a person's account. */
export const AUDIT_CATEGORIES = ["change", "security"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/**
 * Every kind of event, its category, and the sentence the log shows after the
 * actor's name. `{target}` is replaced with the label of the thing changed.
 *
 * Written as one object so a kind cannot exist without a category and a
 * sentence: `AuditKind` is its key list.
 */
export const AUDIT_KINDS = {
	// ── The workspace ──────────────────────────────────────────────────────────
	"organization.updated": {
		category: "change",
		sentence: "changed the workspace settings",
	},
	"org_settings.updated": {
		category: "change",
		sentence: "changed the tracking settings",
	},
	"reminder_settings.updated": {
		category: "change",
		sentence: "changed the reminder settings",
	},
	"assistant_settings.updated": {
		category: "change",
		sentence: "changed the assistant settings",
	},
	"audit_log.retention_changed": {
		category: "change",
		sentence: "changed how long the audit log is kept",
	},
	"audit_log.exported": {
		category: "change",
		sentence: "exported the audit log",
	},

	// ── People ─────────────────────────────────────────────────────────────────
	"member.invited": { category: "change", sentence: "invited {target}" },
	"member.invitation_cancelled": {
		category: "change",
		sentence: "cancelled the invitation for {target}",
	},
	"member.joined": { category: "change", sentence: "added {target}" },
	"member.removed": { category: "change", sentence: "removed {target}" },
	"member.claim_declined": {
		category: "change",
		sentence: "declined to join from a Harvest import",
	},
	"member.role_changed": {
		category: "change",
		sentence: "changed the role of {target}",
	},
	"member.archived": { category: "change", sentence: "archived {target}" },
	"member.restored": { category: "change", sentence: "restored {target}" },
	"member.type_changed": {
		category: "change",
		sentence: "changed the person type of {target}",
	},
	"member.start_date_changed": {
		category: "change",
		sentence: "changed the start date of {target}",
	},
	"member.email_confirmed": {
		category: "change",
		sentence: "confirmed the email address of {target}",
	},
	"team_lead.people_changed": {
		category: "change",
		sentence: "changed the people of {target}",
	},

	// ── Clients, projects and tasks ────────────────────────────────────────────
	"client.created": { category: "change", sentence: "created {target}" },
	"client.updated": { category: "change", sentence: "changed {target}" },
	"client.archived": { category: "change", sentence: "archived {target}" },
	"client.restored": { category: "change", sentence: "restored {target}" },
	"project.created": { category: "change", sentence: "created {target}" },
	"project.updated": { category: "change", sentence: "changed {target}" },
	"project.archived": { category: "change", sentence: "archived {target}" },
	"project.restored": { category: "change", sentence: "restored {target}" },
	"project.member_assigned": {
		category: "change",
		sentence: "assigned a person to {target}",
	},
	"project.member_removed": {
		category: "change",
		sentence: "removed a person from {target}",
	},
	"task.created": { category: "change", sentence: "created {target}" },
	"task.updated": { category: "change", sentence: "changed {target}" },
	"task.archived": { category: "change", sentence: "archived {target}" },
	"task.restored": { category: "change", sentence: "restored {target}" },

	// ── Time rules ─────────────────────────────────────────────────────────────
	"hour_fund.set": {
		category: "change",
		sentence: "set the hour fund for {target}",
	},
	"hour_fund.cleared": {
		category: "change",
		sentence: "cleared the hour fund for {target}",
	},
	"hour_fund.prefilled": {
		category: "change",
		sentence: "filled in the hour funds for {target}",
	},
	"holiday.disabled": {
		category: "change",
		sentence: "turned off the holiday {target}",
	},
	"holiday.enabled": {
		category: "change",
		sentence: "turned on the holiday {target}",
	},

	// ── Time of another person ─────────────────────────────────────────────────
	"absence.logged_for_person": {
		category: "change",
		sentence: "logged time off for {target}",
	},
	"absence.changed_for_person": {
		category: "change",
		sentence: "changed time off for {target}",
	},
	"absence.removed_for_person": {
		category: "change",
		sentence: "removed time off for {target}",
	},

	// ── Integrations ───────────────────────────────────────────────────────────
	"webhook.created": { category: "change", sentence: "created {target}" },
	"webhook.updated": { category: "change", sentence: "changed {target}" },
	"webhook.deleted": { category: "change", sentence: "deleted {target}" },
	"webhook.secret_rolled": {
		category: "change",
		sentence: "rolled the secret of {target}",
	},
	"github.connected": {
		category: "change",
		sentence: "connected the GitHub account {target}",
	},
	"github.disconnected": {
		category: "change",
		sentence: "disconnected the GitHub account {target}",
	},
	"github.repo_linked": {
		category: "change",
		sentence: "linked the repository {target}",
	},
	"github.repo_unlinked": {
		category: "change",
		sentence: "unlinked the repository {target}",
	},
	"slack.connected": {
		category: "change",
		sentence: "connected the Slack workspace {target}",
	},
	"slack.disconnected": {
		category: "change",
		sentence: "disconnected Slack",
	},
	"import.finished": {
		category: "change",
		sentence: "imported from Harvest",
	},
	"import.undone": {
		category: "change",
		sentence: "undid a Harvest import",
	},

	// ── Security ───────────────────────────────────────────────────────────────
	"auth.signed_in": { category: "security", sentence: "signed in" },
	"auth.sign_in_failed": {
		category: "security",
		sentence: "failed to sign in",
	},
	"auth.signed_out": { category: "security", sentence: "signed out" },
	"session.revoked": {
		category: "security",
		sentence: "signed out a device",
	},
	"account.linked": {
		category: "security",
		sentence: "connected the sign-in method {target}",
	},
	"account.unlinked": {
		category: "security",
		sentence: "disconnected the sign-in method {target}",
	},
	"api_token.created": {
		category: "security",
		sentence: "created the API token {target}",
	},
	"api_token.revoked": {
		category: "security",
		sentence: "revoked the API token {target}",
	},
	"impersonation.started": {
		category: "security",
		sentence: "started to impersonate {target}",
	},
	"impersonation.stopped": {
		category: "security",
		sentence: "stopped impersonating {target}",
	},
} as const satisfies Record<
	string,
	{ category: AuditCategory; sentence: string }
>;

export type AuditKind = keyof typeof AUDIT_KINDS;

// SAFETY: `AUDIT_KINDS` is a literal object with no prototype additions, so
// its own keys are exactly the members of `AuditKind`.
export const AUDIT_KIND_NAMES = Object.keys(AUDIT_KINDS) as AuditKind[];

export const isAuditKind = (value: string): value is AuditKind =>
	Object.hasOwn(AUDIT_KINDS, value);

export const auditCategoryOf = (kind: AuditKind): AuditCategory =>
	AUDIT_KINDS[kind].category;

/** The sentence after the actor's name, with the target filled in. A kind
 *  this build does not know (a row written by a newer build, read by an older
 *  one) reads as its own name rather than failing the page. */
export const describeAuditEvent = (
	kind: string,
	targetLabel: string | null,
): string => {
	if (!isAuditKind(kind)) return kind;
	return AUDIT_KINDS[kind].sentence.replace(
		"{target}",
		targetLabel ?? "an item that no longer exists",
	);
};

/** One changed field: the value before and after. */
export type AuditFieldChange = { from: AuditValue; to: AuditValue };
export type AuditValue = string | number | boolean | null | string[];
export type AuditChanges = Record<string, AuditFieldChange>;

/** What a diff shows in place of a secret. */
export const AUDIT_REDACTED = "[redacted]";

/** How long an organization keeps its log, in days. A closed list, so the
 *  sweep cannot be asked to keep a row for a day or for ever. */
export const AUDIT_RETENTION_DAYS = [90, 365, 730, 2555] as const;
export type AuditRetentionDays = (typeof AUDIT_RETENTION_DAYS)[number];
export const DEFAULT_AUDIT_RETENTION_DAYS: AuditRetentionDays = 365;

export const AUDIT_RETENTION_LABELS = {
	90: "90 days",
	365: "1 year",
	730: "2 years",
	2555: "7 years",
} as const satisfies Record<AuditRetentionDays, string>;
