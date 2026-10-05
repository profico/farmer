/**
 * The answers of the routes for the workspace admin. The rules of
 * `schemas.ts` apply: an unknown field is dropped, and a value from an open
 * set is read as a string.
 */

import { z } from "zod";

import type { Expect, Parses } from "./contract";
import { jsonValueSchema } from "./json";
import type { components } from "./openapi.gen";

type Schemas = components["schemas"];

export const managedTaskSchema = z.object({
	id: z.string(),
	name: z.string(),
	group: z.string(),
	isAbsence: z.boolean(),
	systemKey: z.string().nullable(),
	/** `site` for a built-in, which cannot be changed. */
	scope: z.string(),
	color: z.string().nullable(),
	description: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	archivedAt: z.string().nullable(),
	/** The organization's entries on the task. */
	entryCount: z.number(),
});
export type ManagedTask = z.output<typeof managedTaskSchema>;

export const reminderSettingsSchema = z.object({
	logEnabled: z.boolean(),
	logMode: z.string(),
	logTime: z.string(),
	logBelowPct: z.number(),
	nudgeEnabled: z.boolean(),
	nudgeWeekdays: z.array(z.number()),
	nudgeTime: z.string(),
	nudgeMemberTypes: z.array(z.string()),
	monthEndEnabled: z.boolean(),
	monthEndDaysBefore: z.number(),
	monthEndTime: z.string(),
	monthEndOnlyBehind: z.boolean(),
	monthEndMemberTypes: z.array(z.string()),
	digestEnabled: z.boolean(),
	digestWeekday: z.number(),
	digestTime: z.string(),
	includeNeverSignedIn: z.boolean(),
});
export type ReminderSettings = z.output<typeof reminderSettingsSchema>;

export const reminderPreviewSchema = z.object({
	kind: z.string(),
	/** A day, yyyy-MM-dd. */
	date: z.string(),
	/** Why nothing of this kind goes out on `date`, or null. */
	skipped: z.string().nullable(),
	/**
	 * HH:mm in the organization's timezone, or null for the end of each person's
	 * own workday.
	 */
	sendsAt: z.string().nullable(),
	recipients: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.string(),
			reason: z.string(),
			message: z.string(),
		}),
	),
	/** People the rules picked and a delivery rule holds back, with the reason. */
	heldBack: z.array(
		z.object({
			userId: z.string(),
			name: z.string(),
			email: z.string(),
			reason: z.string(),
		}),
	),
});
export type ReminderPreview = z.output<typeof reminderPreviewSchema>;

export const githubInstallationSchema = z.object({
	id: z.string(),
	/** GitHub's own id. */
	installationId: z.number(),
	accountLogin: z.string(),
	/** "Organization" or "User". */
	accountType: z.string(),
	/** An instant, ISO 8601 in UTC. */
	connectedAt: z.string(),
});
export type GithubInstallation = z.output<typeof githubInstallationSchema>;

export const githubWorkspaceSchema = z.object({
	/** False when the deployment has no GitHub App. */
	appConfigured: z.boolean(),
	installations: z.array(githubInstallationSchema),
});
export type GithubWorkspace = z.output<typeof githubWorkspaceSchema>;

export const installUrlSchema = z.object({
	/**
	 * Open it in the system browser. The provider's callback lands on the web
	 * app, which needs a signed-in session there.
	 */
	url: z.string(),
});
export type InstallUrl = z.output<typeof installUrlSchema>;

export const githubDisconnectSchema = z.object({
	/**
	 * What happened to the App on GitHub. `shared`: another workspace still uses
	 * the installation, so it stays.
	 */
	uninstall: z.string(),
});
export type GithubDisconnect = z.output<typeof githubDisconnectSchema>;

export const slackStatusSchema = z.object({
	/** False when the deployment has no Slack app. */
	appConfigured: z.boolean(),
	connected: z.boolean(),
	/** An install is stored and cannot send. Install again to fix it. */
	needsReconnect: z.boolean(),
	reason: z.string().nullable(),
	teamId: z.string().nullable(),
	teamName: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	connectedAt: z.string().nullable(),
	mappedPeople: z.number().nullable(),
});
export type SlackStatus = z.output<typeof slackStatusSchema>;

export const slackMatchSchema = z.object({
	/** People found in Slack by email. */
	mapped: z.number(),
});
export type SlackMatch = z.output<typeof slackMatchSchema>;

export const slackTestSchema = z.object({
	sent: z.boolean(),
});
export type SlackTest = z.output<typeof slackTestSchema>;

export const webhookEndpointSchema = z.object({
	id: z.string(),
	url: z.string(),
	description: z.string().nullable(),
	enabledEvents: z.array(z.string()),
	/** The last four characters of the signing secret. */
	secretHint: z.string(),
	/** Set while the secret before a roll still signs. */
	previousSecretExpiresAt: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	disabledAt: z.string().nullable(),
	disabledReason: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	lastSuccessAt: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	failingSince: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
	createdByName: z.string().nullable(),
});
export type WebhookEndpoint = z.output<typeof webhookEndpointSchema>;

export const webhookEndpointCreatedSchema = z.object({
	endpoint: webhookEndpointSchema,
	/** The signing secret. Readable only in this answer. */
	secret: z.string(),
});
export type WebhookEndpointCreated = z.output<
	typeof webhookEndpointCreatedSchema
>;

export const webhookSecretSchema = z.object({
	/** The new signing secret. Readable only in this answer. */
	secret: z.string(),
});
export type WebhookSecret = z.output<typeof webhookSecretSchema>;

export const webhookTestSchema = z.object({
	eventId: z.string(),
});
export type WebhookTest = z.output<typeof webhookTestSchema>;

export const webhookDeliverySchema = z.object({
	id: z.string(),
	eventId: z.string(),
	kind: z.string(),
	attempt: z.number(),
	/** Queued by Resend, not by the schedule. */
	manual: z.boolean(),
	/** Set only while the attempt waits to be sent. */
	nextAttemptAt: z.string().nullable(),
	/** An instant, ISO 8601 in UTC. */
	attemptedAt: z.string().nullable(),
	statusCode: z.number().nullable(),
	error: z.string().nullable(),
	responseSample: z.string().nullable(),
	durationMs: z.number().nullable(),
	/** An instant, ISO 8601 in UTC. */
	createdAt: z.string(),
	/** False once the payload was deleted, or before a send. */
	canResend: z.boolean(),
});
export type WebhookDelivery = z.output<typeof webhookDeliverySchema>;

export const webhookResendSchema = z.object({
	/** The new attempt. */
	deliveryId: z.string(),
});
export type WebhookResend = z.output<typeof webhookResendSchema>;

export const auditEventSchema = z.object({
	id: z.string(),
	/** An instant, ISO 8601 in UTC. */
	occurredAt: z.string(),
	kind: z.string(),
	/** `change` or `security`. */
	category: z.string(),
	/** The sentence the web app shows. */
	summary: z.string(),
	actorUserId: z.string().nullable(),
	actorName: z.string().nullable(),
	impersonatorName: z.string().nullable(),
	via: z.string(),
	ip: z.string().nullable(),
	userAgent: z.string().nullable(),
	targetType: z.string().nullable(),
	targetId: z.string().nullable(),
	targetLabel: z.string().nullable(),
	subjectUserId: z.string().nullable(),
	/** Each changed field. A secret reads `[redacted]`. */
	changes: z
		.record(
			z.string(),
			z.object({
				from: z
					.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
					.nullable(),
				to: z
					.union([z.string(), z.number(), z.boolean(), z.array(z.string())])
					.nullable(),
			}),
		)
		.nullable(),
	details: z.record(z.string(), jsonValueSchema).nullable(),
});
export type AuditEvent = z.output<typeof auditEventSchema>;

export const auditPageSchema = z.object({
	events: z.array(auditEventSchema),
	/** Send it as `cursor` for the next page. Null on the last. */
	nextCursor: z.string().nullable(),
});
export type AuditPage = z.output<typeof auditPageSchema>;

export const auditExportSchema = z.object({
	csv: z.string(),
	rows: z.number(),
	/** True when the range held more than 10,000 rows. */
	truncated: z.boolean(),
});
export type AuditExport = z.output<typeof auditExportSchema>;

export const auditRetentionSchema = z.object({
	days: z.number(),
});
export type AuditRetention = z.output<typeof auditRetentionSchema>;

export const hourFundMonthSchema = z.object({
	year: z.number(),
	/** 1 is January. */
	month: z.number(),
	fundSeconds: z.number(),
});
export type HourFundMonth = z.output<typeof hourFundMonthSchema>;

export const hourFundSuggestionSchema = z.object({
	workingDays: z.number(),
	fundSeconds: z.number(),
});
export type HourFundSuggestion = z.output<typeof hourFundSuggestionSchema>;

export const organizationSettingsSchema = z.object({
	name: z.string(),
	/** ISO 3166-1 alpha-2. */
	country: z.string(),
	/** An IANA timezone. */
	timezone: z.string(),
	/** 1 is Monday, 0 is Sunday. */
	weekStartsOn: z.number(),
	logo: z.string().nullable(),
});
export type OrganizationSettings = z.output<typeof organizationSettingsSchema>;

// Each answer the document describes must parse with the schema above.
export type AdminContractChecks = [
	Expect<Parses<Schemas["ManagedTask"], typeof managedTaskSchema>>,
	Expect<Parses<Schemas["ReminderSettings"], typeof reminderSettingsSchema>>,
	Expect<Parses<Schemas["ReminderPreview"], typeof reminderPreviewSchema>>,
	Expect<
		Parses<Schemas["GithubInstallation"], typeof githubInstallationSchema>
	>,
	Expect<Parses<Schemas["GithubWorkspace"], typeof githubWorkspaceSchema>>,
	Expect<Parses<Schemas["InstallUrl"], typeof installUrlSchema>>,
	Expect<Parses<Schemas["GithubDisconnect"], typeof githubDisconnectSchema>>,
	Expect<Parses<Schemas["SlackStatus"], typeof slackStatusSchema>>,
	Expect<Parses<Schemas["SlackMatch"], typeof slackMatchSchema>>,
	Expect<Parses<Schemas["SlackTest"], typeof slackTestSchema>>,
	Expect<Parses<Schemas["WebhookEndpoint"], typeof webhookEndpointSchema>>,
	Expect<
		Parses<
			Schemas["WebhookEndpointCreated"],
			typeof webhookEndpointCreatedSchema
		>
	>,
	Expect<Parses<Schemas["WebhookSecret"], typeof webhookSecretSchema>>,
	Expect<Parses<Schemas["WebhookTest"], typeof webhookTestSchema>>,
	Expect<Parses<Schemas["WebhookDelivery"], typeof webhookDeliverySchema>>,
	Expect<Parses<Schemas["WebhookResend"], typeof webhookResendSchema>>,
	Expect<Parses<Schemas["AuditEvent"], typeof auditEventSchema>>,
	Expect<Parses<Schemas["AuditPage"], typeof auditPageSchema>>,
	Expect<Parses<Schemas["AuditExport"], typeof auditExportSchema>>,
	Expect<Parses<Schemas["AuditRetention"], typeof auditRetentionSchema>>,
	Expect<Parses<Schemas["HourFundMonth"], typeof hourFundMonthSchema>>,
	Expect<
		Parses<Schemas["HourFundSuggestion"], typeof hourFundSuggestionSchema>
	>,
	Expect<
		Parses<Schemas["OrganizationSettings"], typeof organizationSettingsSchema>
	>,
];
