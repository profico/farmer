// The workspace admin projections, for the reason `time-entries.test.ts` gives:
// a column added to a row must not become a field the mobile app starts to
// depend on. Three of these rows sit beside a credential, so each test also
// hands the projection a secret and checks that it does not come out.

import { describe, expect, test } from "bun:test";

import { REMINDER_SETTINGS_DEFAULTS } from "../schema/reminder-settings";
import {
	toApiAuditPage,
	toApiGithubInstallation,
	toApiReminderSettings,
	toApiSlackStatus,
	toApiWebhookDelivery,
	toApiWebhookEndpoint,
} from "./admin";

const AT = new Date("2026-10-06T08:00:00Z");

describe("toApiReminderSettings", () => {
	test("keeps the settings and nothing else", () => {
		const row = {
			...REMINDER_SETTINGS_DEFAULTS,
			organizationId: "org-1",
			updatedAt: AT,
		};
		expect(toApiReminderSettings(row)).toStrictEqual(
			REMINDER_SETTINGS_DEFAULTS,
		);
	});
});

describe("toApiWebhookEndpoint", () => {
	test("never carries the signing secret", () => {
		const view = {
			id: "w-1",
			url: "https://example.com/hook",
			description: null,
			enabledEvents: ["client.created" as const],
			secretHint: "abcd",
			secret: "whsec_full_secret_abcd",
			previousSecret: "whsec_old",
			previousSecretExpiresAt: null,
			disabledAt: AT,
			disabledReason: "Turned off by an admin",
			lastSuccessAt: null,
			failingSince: null,
			createdAt: AT,
			createdByName: "Ada",
		};
		const endpoint = toApiWebhookEndpoint(view);
		expect(endpoint).toStrictEqual({
			id: "w-1",
			url: "https://example.com/hook",
			description: null,
			enabledEvents: ["client.created"],
			secretHint: "abcd",
			previousSecretExpiresAt: null,
			disabledAt: "2026-10-06T08:00:00.000Z",
			disabledReason: "Turned off by an admin",
			lastSuccessAt: null,
			failingSince: null,
			createdAt: "2026-10-06T08:00:00.000Z",
			createdByName: "Ada",
		});
		expect(JSON.stringify(endpoint)).not.toContain("whsec_");
	});
});

describe("toApiWebhookDelivery", () => {
	test("keeps exactly the fields it names, dates as ISO strings", () => {
		const view = {
			id: "d-1",
			eventId: "e-1",
			kind: "webhook.test",
			attempt: 2,
			manual: true,
			nextAttemptAt: null,
			attemptedAt: AT,
			statusCode: 500,
			error: "The endpoint answered 500",
			responseSample: "no",
			durationMs: 12,
			createdAt: AT,
			canResend: true,
			organizationId: "org-1",
		};
		expect(toApiWebhookDelivery(view)).toStrictEqual({
			id: "d-1",
			eventId: "e-1",
			kind: "webhook.test",
			attempt: 2,
			manual: true,
			nextAttemptAt: null,
			attemptedAt: "2026-10-06T08:00:00.000Z",
			statusCode: 500,
			error: "The endpoint answered 500",
			responseSample: "no",
			durationMs: 12,
			createdAt: "2026-10-06T08:00:00.000Z",
			canResend: true,
		});
	});
});

describe("toApiGithubInstallation", () => {
	test("keeps the account, not who connected it", () => {
		const row = {
			id: "g-1",
			organizationId: "org-1",
			installationId: 42,
			accountLogin: "acme",
			accountType: "Organization",
			connectedByUserId: "u-1",
			createdAt: AT,
			updatedAt: AT,
		};
		expect(toApiGithubInstallation(row)).toStrictEqual({
			id: "g-1",
			installationId: 42,
			accountLogin: "acme",
			accountType: "Organization",
			connectedAt: "2026-10-06T08:00:00.000Z",
		});
	});
});

describe("toApiSlackStatus", () => {
	test("a connection is one flat shape, and never the bot token", () => {
		const status = {
			connected: true as const,
			needsReconnect: false as const,
			teamId: "T1",
			teamName: "Acme",
			connectedAt: AT,
			mappedPeople: 3,
			botToken: "xoxb-secret",
		};
		const answer = toApiSlackStatus(status, true);
		expect(answer).toStrictEqual({
			appConfigured: true,
			connected: true,
			needsReconnect: false,
			reason: null,
			teamId: "T1",
			teamName: "Acme",
			connectedAt: "2026-10-06T08:00:00.000Z",
			mappedPeople: 3,
		});
		expect(JSON.stringify(answer)).not.toContain("xoxb");
	});

	test("a refused install says why, and nothing is connected", () => {
		expect(
			toApiSlackStatus(
				{
					connected: false,
					needsReconnect: true,
					reason: "rejected",
					teamName: "Acme",
				},
				true,
			),
		).toStrictEqual({
			appConfigured: true,
			connected: false,
			needsReconnect: true,
			reason: "rejected",
			teamId: null,
			teamName: "Acme",
			connectedAt: null,
			mappedPeople: null,
		});
	});

	test("never connected", () => {
		expect(
			toApiSlackStatus({ connected: false, needsReconnect: false }, false),
		).toStrictEqual({
			appConfigured: false,
			connected: false,
			needsReconnect: false,
			reason: null,
			teamId: null,
			teamName: null,
			connectedAt: null,
			mappedPeople: null,
		});
	});
});

describe("toApiAuditPage", () => {
	const event = {
		id: "a-1",
		occurredAt: "2026-10-06T08:00:00.000Z",
		kind: "member.joined",
		category: "change",
		actorUserId: "u-1",
		actorName: "Ada",
		impersonatorName: null,
		via: "web",
		ip: null,
		userAgent: null,
		targetType: "member",
		targetId: "u-1",
		targetLabel: "Ada",
		subjectUserId: "u-1",
		changes: { role: { from: "member", to: "admin" } },
		details: { importRunId: "r-1" },
	};

	test("adds the sentence, and passes `self` when the actor is the subject", () => {
		const seen: boolean[] = [];
		const page = toApiAuditPage(
			{ events: [event], nextCursor: "next" },
			(kind, label, self) => {
				seen.push(self);
				return `${kind}:${label ?? ""}`;
			},
		);
		expect(seen).toEqual([true]);
		expect(page).toStrictEqual({
			events: [{ ...event, summary: "member.joined:Ada" }],
			nextCursor: "next",
		});
	});
});
