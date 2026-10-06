import type { AuditEvent, AuditExportRange } from "@farmer/api-client";

import type { Option } from "../components";

/** One kind of audit event, such as `member.role_changed`. */
export type AuditKind = NonNullable<AuditExportRange["kind"]>;

/** `change` or `security`. */
export type AuditCategory = NonNullable<AuditExportRange["category"]>;

/** The retention choices, in days. */
export type AuditRetentionDays = 90 | 365 | 730 | 2555;

/**
 * A readable label for each kind, in the order of the web app. The
 * `satisfies` clause fails to compile when a kind has no label.
 */
const KIND_LABELS = {
	"organization.created": "Workspace created",
	"organization.updated": "Workspace settings changed",
	"org_settings.updated": "Tracking settings changed",
	"reminder_settings.updated": "Reminder settings changed",
	"assistant_settings.updated": "Assistant settings changed",
	"audit_log.retention_changed": "Audit log retention changed",
	"audit_log.exported": "Audit log exported",
	"member.invited": "Person invited",
	"member.invitation_cancelled": "Invitation cancelled",
	"member.invitation_declined": "Invitation declined",
	"member.joined": "Person joined",
	"member.removed": "Person removed",
	"member.claim_declined": "Harvest import claim declined",
	"member.role_changed": "Role changed",
	"member.archived": "Person archived",
	"member.restored": "Person restored",
	"member.type_changed": "Person type changed",
	"member.start_date_changed": "Start date changed",
	"member.email_confirmed": "Email address confirmed",
	"team_lead.people_changed": "Team lead people changed",
	"client.created": "Client created",
	"client.updated": "Client changed",
	"client.archived": "Client archived",
	"client.restored": "Client restored",
	"project.created": "Project created",
	"project.updated": "Project changed",
	"project.archived": "Project archived",
	"project.restored": "Project restored",
	"project.member_assigned": "Person assigned to a project",
	"project.member_removed": "Person removed from a project",
	"task.created": "Task created",
	"task.updated": "Task changed",
	"task.archived": "Task archived",
	"task.restored": "Task restored",
	"hour_fund.set": "Hour fund set",
	"hour_fund.cleared": "Hour fund cleared",
	"hour_fund.prefilled": "Hour funds filled in",
	"holiday.disabled": "Holiday turned off",
	"holiday.enabled": "Holiday turned on",
	"absence.logged_for_person": "Time off logged for a person",
	"absence.changed_for_person": "Time off changed for a person",
	"absence.removed_for_person": "Time off removed for a person",
	"webhook.created": "Webhook created",
	"webhook.updated": "Webhook changed",
	"webhook.deleted": "Webhook deleted",
	"webhook.secret_rolled": "Webhook secret rolled",
	"github.connected": "GitHub connected",
	"github.disconnected": "GitHub disconnected",
	"github.repo_linked": "Repository linked",
	"github.repo_unlinked": "Repository unlinked",
	"slack.connected": "Slack connected",
	"slack.disconnected": "Slack disconnected",
	"import.finished": "Harvest import finished",
	"import.undone": "Harvest import undone",
	"auth.signed_in": "Signed in",
	"auth.sign_in_failed": "Sign-in failed",
	"auth.signed_out": "Signed out",
	"session.revoked": "Device signed out",
	"account.linked": "Sign-in method connected",
	"account.unlinked": "Sign-in method disconnected",
	"api_token.created": "API token created",
	"api_token.revoked": "API token revoked",
	"impersonation.started": "Impersonation started",
	"impersonation.stopped": "Impersonation stopped",
} satisfies { [kind in AuditKind]: string };

/** The kinds as options for a choice. */
// SAFETY: `KIND_LABELS` is a literal object whose keys are exactly the
// members of `AuditKind`, as its `satisfies` clause checks.
export const KIND_OPTIONS: Option<AuditKind>[] = (
	Object.keys(KIND_LABELS) as AuditKind[]
).map((value) => ({ value, label: KIND_LABELS[value] }));

/** The kind from a route parameter, or undefined for a value that no kind
 *  has. */
export const kindOfParam = (value: string | undefined) =>
	KIND_OPTIONS.find((option) => option.value === value)?.value;

/** The category from a route parameter. */
export const categoryOfParam = (value: string | undefined) =>
	value === "change" || value === "security" ? value : undefined;

const VIA_LABELS = {
	web: "Web",
	api: "API",
	api_token: "API token",
	cli: "CLI",
	mcp: "MCP",
	assistant: "Assistant",
	system: "System",
} satisfies { [via: string]: string };

/** The label of a stored `via`, or the raw value for one that this build
 *  does not know. */
export const viaLabel = (via: string) =>
	Object.entries(VIA_LABELS).find(([key]) => key === via)?.[1] ?? via;

/** The retention choices with the labels of the web app. */
export const RETENTION_OPTIONS = [
	{ value: 90, label: "90 days" },
	{ value: 365, label: "1 year" },
	{ value: 730, label: "2 years" },
	{ value: 2555, label: "7 years" },
] satisfies Option<AuditRetentionDays>[];

/** The label of a retention in days. A value that is not in the list shows
 *  as a number of days. */
export const retentionLabel = (days: number) =>
	RETENTION_OPTIONS.find((option) => option.value === days)?.label ??
	`${days} days`;

type Change = NonNullable<AuditEvent["changes"]>[string];

/** A changed value as text. */
export const formatValue = (value: Change["from"]): string => {
	if (value === null || value === "") return "none";
	if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "none";
	if (value === true) return "On";
	if (value === false) return "Off";
	return String(value);
};

/** A detail as text: a number or a string as it is, anything larger as
 *  JSON. */
export const detailText = (
	value: NonNullable<AuditEvent["details"]>[string],
): string => {
	if (value === null) return "none";
	return value instanceof Object ? JSON.stringify(value) : String(value);
};

/** `trackingTolerancePct` as "Tracking tolerance pct". */
export const fieldLabel = (field: string) => {
	const words = field
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A day key (yyyy-MM-dd) moved by a number of days. */
export const addDays = (key: string, days: number) =>
	new Date(new Date(`${key}T00:00:00Z`).getTime() + days * DAY_MS)
		.toISOString()
		.slice(0, 10);
