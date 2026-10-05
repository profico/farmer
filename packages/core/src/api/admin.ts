/**
 * The workspace admin screens, as the REST API answers them: reminders, the
 * workspace integrations, the outbound webhooks and the audit log.
 *
 * Projections for the reason `time-entries.ts` gives, and one more: three of
 * these rows sit beside a credential. The Slack bot token, the OpenRouter key
 * and a webhook's signing secret are never in a projection here. A webhook
 * secret goes out exactly twice, on create and on a roll, as the web app shows
 * it. Every `Date` becomes an ISO string, because that is what JSON can carry.
 *
 * Every route that answers one of these is admin only. The service asserts it,
 * so a member's token gets 403 and not a projection.
 */

import type { AuditChanges } from "../lib/audit";
import type { JsonRecord } from "../lib/json";
import type {
	ReminderKind,
	ReminderSettings,
} from "../schema/reminder-settings";
import type { AuditEventView, AuditPage } from "../services/audit";
import type { UninstallOutcome } from "../services/github.service";
import type { ReminderPreview } from "../services/reminder-settings.service";
import type {
	WebhookDeliveryView,
	WebhookEndpointView,
} from "../services/webhooks.service";
import type { WebhookEventKind } from "./webhooks";

const isoOrNull = (value: Date | null): string | null =>
	value ? value.toISOString() : null;

// ── Reminders ────────────────────────────────────────────────────────────────

/** `GET` and `PATCH /api/v1/orgs/$slug/reminders`. The settings row, with the
 *  defaults filled in when the org never saved one. */
export type ApiReminderSettings = ReminderSettings;

export const toApiReminderSettings = (
	row: ReminderSettings,
): ApiReminderSettings => ({
	logEnabled: row.logEnabled,
	logMode: row.logMode,
	logTime: row.logTime,
	logBelowPct: row.logBelowPct,
	nudgeEnabled: row.nudgeEnabled,
	nudgeWeekdays: [...row.nudgeWeekdays],
	nudgeTime: row.nudgeTime,
	nudgeMemberTypes: [...row.nudgeMemberTypes],
	monthEndEnabled: row.monthEndEnabled,
	monthEndDaysBefore: row.monthEndDaysBefore,
	monthEndTime: row.monthEndTime,
	monthEndOnlyBehind: row.monthEndOnlyBehind,
	monthEndMemberTypes: [...row.monthEndMemberTypes],
	digestEnabled: row.digestEnabled,
	digestWeekday: row.digestWeekday,
	digestTime: row.digestTime,
	includeNeverSignedIn: row.includeNeverSignedIn,
});

type ApiReminderPerson = {
	userId: string;
	name: string;
	email: string;
	reason: string;
};

/** `GET /api/v1/orgs/$slug/reminders/preview` — who gets one kind of reminder
 *  on one day, by the rules the job sends by. */
export type ApiReminderPreview = {
	kind: ReminderKind;
	date: string;
	skipped: string | null;
	sendsAt: string | null;
	recipients: (ApiReminderPerson & { message: string })[];
	heldBack: ApiReminderPerson[];
};

const toPerson = (person: ApiReminderPerson): ApiReminderPerson => ({
	userId: person.userId,
	name: person.name,
	email: person.email,
	reason: person.reason,
});

export const toApiReminderPreview = (
	preview: ReminderPreview,
): ApiReminderPreview => ({
	kind: preview.kind,
	date: preview.date,
	skipped: preview.skipped,
	sendsAt: preview.sendsAt,
	recipients: preview.recipients.map((person) => ({
		...toPerson(person),
		message: person.message,
	})),
	heldBack: preview.heldBack.map(toPerson),
});

// ── Workspace integrations ───────────────────────────────────────────────────

/** A URL the app opens in the system browser. The provider's own page does
 *  the install, and its callback lands on the web app. */
export type ApiInstallUrl = { url: string };

export type ApiGithubInstallation = {
	id: string;
	/** GitHub's own id for the installation. */
	installationId: number;
	accountLogin: string;
	/** "Organization" or "User", as GitHub says it. */
	accountType: string;
	connectedAt: string;
};

/** `GET /api/v1/orgs/$slug/workspace-integrations/github`. */
export type ApiGithubWorkspace = {
	/** False when the deployment has no GitHub App. Installing is then not
	 *  possible, and the install URL route refuses. */
	appConfigured: boolean;
	installations: ApiGithubInstallation[];
};

export const toApiGithubInstallation = (row: {
	id: string;
	installationId: number;
	accountLogin: string;
	accountType: string;
	createdAt: Date;
}): ApiGithubInstallation => ({
	id: row.id,
	installationId: row.installationId,
	accountLogin: row.accountLogin,
	accountType: row.accountType,
	connectedAt: row.createdAt.toISOString(),
});

/** `DELETE /api/v1/orgs/$slug/workspace-integrations/github/installations/$id`. */
export type ApiGithubDisconnect = { uninstall: UninstallOutcome };

/** The union `slackService.status` answers. */
type SlackStatus =
	| {
			connected: false;
			needsReconnect: true;
			reason: "rejected" | "unreadable";
			teamName: string | null;
	  }
	| { connected: false; needsReconnect: false }
	| {
			connected: true;
			needsReconnect: false;
			teamId: string;
			teamName: string | null;
			connectedAt: Date;
			mappedPeople: number;
	  };

/** `GET /api/v1/orgs/$slug/workspace-integrations/slack`. One flat shape for the three
 *  states, so a client reads a field rather than a union tag. */
export type ApiSlackStatus = {
	/** False when the deployment has no Slack app. */
	appConfigured: boolean;
	connected: boolean;
	/** A stored install that cannot send: Slack refused the token, or it does
	 *  not decrypt. Install again to fix it. */
	needsReconnect: boolean;
	reason: "rejected" | "unreadable" | null;
	teamId: string | null;
	teamName: string | null;
	connectedAt: string | null;
	mappedPeople: number | null;
};

export const toApiSlackStatus = (
	status: SlackStatus,
	appConfigured: boolean,
): ApiSlackStatus => {
	if (status.connected) {
		return {
			appConfigured,
			connected: true,
			needsReconnect: false,
			reason: null,
			teamId: status.teamId,
			teamName: status.teamName,
			connectedAt: status.connectedAt.toISOString(),
			mappedPeople: status.mappedPeople,
		};
	}
	return {
		appConfigured,
		connected: false,
		needsReconnect: status.needsReconnect,
		reason: status.needsReconnect ? status.reason : null,
		teamId: null,
		teamName: status.needsReconnect ? status.teamName : null,
		connectedAt: null,
		mappedPeople: null,
	};
};

/** `POST /api/v1/orgs/$slug/workspace-integrations/slack/match-people`. */
export type ApiSlackMatch = { mapped: number };

/** `POST /api/v1/orgs/$slug/workspace-integrations/slack/test`. A send that fails is an
 *  error, so this is always true. */
export type ApiSlackTest = { sent: true };

// ── Webhooks ─────────────────────────────────────────────────────────────────

/** One endpoint. Never the secret: `secretHint` is its last four characters. */
export type ApiWebhookEndpoint = {
	id: string;
	url: string;
	description: string | null;
	enabledEvents: WebhookEventKind[];
	secretHint: string;
	previousSecretExpiresAt: string | null;
	disabledAt: string | null;
	disabledReason: string | null;
	lastSuccessAt: string | null;
	failingSince: string | null;
	createdAt: string;
	createdByName: string | null;
};

export const toApiWebhookEndpoint = (
	view: WebhookEndpointView,
): ApiWebhookEndpoint => ({
	id: view.id,
	url: view.url,
	description: view.description,
	enabledEvents: [...view.enabledEvents],
	secretHint: view.secretHint,
	previousSecretExpiresAt: isoOrNull(view.previousSecretExpiresAt),
	disabledAt: isoOrNull(view.disabledAt),
	disabledReason: view.disabledReason,
	lastSuccessAt: isoOrNull(view.lastSuccessAt),
	failingSince: isoOrNull(view.failingSince),
	createdAt: view.createdAt.toISOString(),
	createdByName: view.createdByName,
});

/** `POST /api/v1/orgs/$slug/webhooks`. The only answer, with the roll, that
 *  carries the signing secret. Show it once. */
export type ApiWebhookEndpointCreated = {
	endpoint: ApiWebhookEndpoint;
	secret: string;
};

/** `POST /api/v1/orgs/$slug/webhooks/$id/roll-secret`. */
export type ApiWebhookSecret = { secret: string };

/** One attempt in the delivery log. */
export type ApiWebhookDelivery = {
	id: string;
	eventId: string;
	kind: string;
	attempt: number;
	manual: boolean;
	nextAttemptAt: string | null;
	attemptedAt: string | null;
	statusCode: number | null;
	error: string | null;
	responseSample: string | null;
	durationMs: number | null;
	createdAt: string;
	canResend: boolean;
};

export const toApiWebhookDelivery = (
	view: WebhookDeliveryView,
): ApiWebhookDelivery => ({
	id: view.id,
	eventId: view.eventId,
	kind: view.kind,
	attempt: view.attempt,
	manual: view.manual,
	nextAttemptAt: isoOrNull(view.nextAttemptAt),
	attemptedAt: isoOrNull(view.attemptedAt),
	statusCode: view.statusCode,
	error: view.error,
	responseSample: view.responseSample,
	durationMs: view.durationMs,
	createdAt: view.createdAt.toISOString(),
	canResend: view.canResend,
});

/** `POST /api/v1/orgs/$slug/webhooks/$id/test`. The event is in the outbox;
 *  the delivery log shows what happened to it. */
export type ApiWebhookTest = { eventId: string };

/** `POST /api/v1/orgs/$slug/webhooks/deliveries/$id/resend`. */
export type ApiWebhookResend = { deliveryId: string };

// ── Audit log ────────────────────────────────────────────────────────────────

export type ApiAuditEvent = {
	id: string;
	occurredAt: string;
	kind: string;
	category: string;
	/** The sentence the web app shows for the row. */
	summary: string;
	actorUserId: string | null;
	actorName: string | null;
	impersonatorName: string | null;
	via: string;
	ip: string | null;
	userAgent: string | null;
	targetType: string | null;
	targetId: string | null;
	targetLabel: string | null;
	subjectUserId: string | null;
	changes: AuditChanges | null;
	details: JsonRecord | null;
};

/** `describe` is `describeAuditEvent` (`lib/audit.ts`). It is passed in, so
 *  this module keeps to type imports. */
export const toApiAuditEvent = (
	view: AuditEventView,
	describe: (kind: string, targetLabel: string | null, self: boolean) => string,
): ApiAuditEvent => ({
	id: view.id,
	occurredAt: view.occurredAt,
	kind: view.kind,
	category: view.category,
	summary: describe(
		view.kind,
		view.targetLabel,
		view.actorUserId !== null && view.actorUserId === view.subjectUserId,
	),
	actorUserId: view.actorUserId,
	actorName: view.actorName,
	impersonatorName: view.impersonatorName,
	via: view.via,
	ip: view.ip,
	userAgent: view.userAgent,
	targetType: view.targetType,
	targetId: view.targetId,
	targetLabel: view.targetLabel,
	subjectUserId: view.subjectUserId,
	changes: view.changes,
	details: view.details,
});

/** `GET /api/v1/orgs/$slug/audit-log`. Newest first. */
export type ApiAuditPage = {
	events: ApiAuditEvent[];
	/** Send back as `cursor` for the next page. Null on the last page. */
	nextCursor: string | null;
};

export const toApiAuditPage = (
	page: AuditPage,
	describe: (kind: string, targetLabel: string | null, self: boolean) => string,
): ApiAuditPage => ({
	events: page.events.map((event) => toApiAuditEvent(event, describe)),
	nextCursor: page.nextCursor,
});

/** `POST /api/v1/orgs/$slug/audit-log/export`. */
export type ApiAuditExport = { csv: string; rows: number; truncated: boolean };

/** `GET` and `PATCH /api/v1/orgs/$slug/audit-log/retention`. */
export type ApiAuditRetention = { days: number };
