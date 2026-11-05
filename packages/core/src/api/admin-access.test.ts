// Who may call the services behind the workspace admin routes of `api/v1`.
//
// The web app puts `orgAdminMiddleware` in front of these screens. The REST API
// has no such middleware, so the service is the only check a bearer token
// meets. Each admin read and write here must refuse a plain member with an
// `AccessError`, which `api-route.ts` answers as 403. Four of them had no check
// of their own before the API reached them: the reminder settings read, the
// GitHub installation list, the GitHub install URL and the Slack re-match.
//
// The assistant's threads are the other side of it: any member may use them,
// and only their own. Another person's thread must read as not found.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { assistantConversation } from "../db/schema/assistant";
import { member, organization, user } from "../db/schema/auth";
import { setInstanceSettingsForTests } from "../lib/instance-settings";
import { AccessError } from "../services/access.service";
import { assistantService } from "../services/assistant.service";
import { auditService } from "../services/audit";
import { classifyServiceError } from "../services/error-message";
import { githubService } from "../services/github.service";
import { holidaysService } from "../services/holidays.service";
import { orgSettingsService } from "../services/org-settings.service";
import { reminderSettingsService } from "../services/reminder-settings.service";
import { slackService } from "../services/slack.service";
import type { Ctx } from "../services/types";
import { uploadsService } from "../services/uploads.service";
import { webhooksService } from "../services/webhooks.service";
import { createTestDb, present, type TestDb } from "../test/harness";

const ORG = "org-api-admin";
const ADMIN = "user-api-admin";
const PLAIN = "user-api-plain";
const UUID = "00000000-0000-4000-8000-000000000001";

const adminCtx = (): Ctx => ({ organizationId: ORG, userId: ADMIN });
const plainCtx = (): Ctx => ({ organizationId: ORG, userId: PLAIN });

let harness: TestDb;

/** The environment wins over the stored settings, and Bun loads the
 *  developer's `.env` into the suite. These two are put back after the file. */
const LOCKED = ["GITHUB_APP_SLUG", "SLACK_CLIENT_ID"] as const;
const saved = new Map<string, string | undefined>();

beforeAll(async () => {
	harness = await createTestDb();
	for (const name of LOCKED) {
		saved.set(name, process.env[name]);
		delete process.env[name];
	}
	setInstanceSettingsForTests({
		GITHUB_APP_SLUG: "farmer-test",
		SLACK_CLIENT_ID: "slack-test",
	});
	await db
		.insert(organization)
		.values({ id: ORG, name: "Admin", slug: ORG, createdAt: new Date() });
	const person = (id: string) => ({
		id,
		name: id,
		email: `${id}@example.com`,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	await db.insert(user).values([person(ADMIN), person(PLAIN)]);
	await db.insert(member).values([
		{
			id: "ma1",
			organizationId: ORG,
			userId: ADMIN,
			role: "owner",
			createdAt: new Date(),
		},
		{
			id: "ma2",
			organizationId: ORG,
			userId: PLAIN,
			role: "member",
			createdAt: new Date(),
		},
	]);
});

afterAll(async () => {
	setInstanceSettingsForTests(undefined);
	for (const [name, value] of saved) {
		if (value !== undefined) process.env[name] = value;
	}
	await harness.close();
});

/** Every admin service call an `api/v1` route makes, with a valid input. */
const ADMIN_CALLS: [string, (ctx: Ctx) => Promise<object | number | void>][] = [
	["reminders: read", (ctx) => reminderSettingsService.getForAdmin(ctx)],
	[
		"reminders: change",
		(ctx) => reminderSettingsService.update(ctx, { logEnabled: false }),
	],
	[
		"reminders: preview",
		(ctx) => reminderSettingsService.preview(ctx, "log-reminder", "2026-10-06"),
	],
	["github: list", (ctx) => githubService.listInstallations(ctx)],
	["github: install url", (ctx) => githubService.installUrl(ctx)],
	[
		"github: disconnect",
		(ctx) =>
			githubService.disconnectInstallation(ctx, {
				installationRowId: UUID,
				uninstall: false,
			}),
	],
	["slack: status", (ctx) => slackService.status(ctx)],
	["slack: install url", (ctx) => slackService.installUrl(ctx)],
	["slack: disconnect", (ctx) => slackService.disconnect(ctx)],
	["slack: match people", (ctx) => slackService.syncIdentities(ctx)],
	["slack: test", (ctx) => slackService.sendTest(ctx, ADMIN)],
	["webhooks: list", (ctx) => webhooksService.list(ctx)],
	[
		"webhooks: deliveries",
		(ctx) => webhooksService.deliveries(ctx, { endpointId: UUID, limit: 10 }),
	],
	[
		"webhooks: resend",
		(ctx) => webhooksService.resend(ctx, { deliveryId: UUID }),
	],
	["audit: list", (ctx) => auditService.list(ctx, {})],
	[
		"audit: export",
		(ctx) =>
			auditService.exportCsv(ctx, { from: "2026-10-01", to: "2026-10-06" }),
	],
	["audit: retention", (ctx) => auditService.retention(ctx)],
	["audit: change retention", (ctx) => auditService.setRetention(ctx, 90)],
	[
		"assistant: connect",
		(ctx) =>
			assistantService.settings.set(ctx, {
				apiKey: "sk-or-v1-0000000000000000",
				defaultModel: "openai/gpt-4o-mini",
			}),
	],
	[
		"assistant: change",
		(ctx) => assistantService.settings.update(ctx, { enabled: false }),
	],
	["assistant: disconnect", (ctx) => assistantService.settings.disconnect(ctx)],
	["assistant: models", (ctx) => assistantService.settings.listModels(ctx)],
	// The last screens of the web app. Each of these had `orgAdminMiddleware` in the web app,
	// and the holiday switch had no check of its own before.
	[
		"holidays: switch one off",
		(ctx) =>
			holidaysService.setHolidayDisabled(ctx, {
				name: "New Year's Day",
				disabled: true,
			}),
	],
	["policy: read", (ctx) => orgSettingsService.getForAdmin(ctx)],
	[
		"policy: change",
		(ctx) => orgSettingsService.update(ctx, { trackingTolerancePct: 10 }),
	],
	["github: repositories", (ctx) => githubService.listAvailableRepos(ctx)],
	[
		"github: repositories, read again",
		(ctx) => githubService.listAvailableRepos(ctx, { refresh: true }),
	],
	[
		"github: link a repository",
		(ctx) =>
			githubService.linkRepo(ctx, {
				projectId: UUID,
				githubRepoId: 1,
				installationId: 1,
			}),
	],
	["github: unlink a repository", (ctx) => githubService.unlinkRepo(ctx, UUID)],
	[
		"uploads: an organization logo",
		(ctx) =>
			uploadsService.uploadImage(ctx, {
				purpose: "org-logo",
				bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			}),
	],
	[
		"uploads: a project icon",
		(ctx) =>
			uploadsService.uploadImage(ctx, {
				purpose: "project-icon",
				bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
			}),
	],
];

describe("the admin routes refuse a plain member", () => {
	for (const [name, call] of ADMIN_CALLS) {
		test(name, async () => {
			const refusal = await call(plainCtx())
				.then(() => null)
				.catch((error: unknown) => (error instanceof Error ? error : null));
			expect(refusal).toBeInstanceOf(AccessError);
			expect(classifyServiceError(present(refusal, "the refusal")).kind).toBe(
				"forbidden",
			);
		});
	}
});

describe("the reads the admin check was added to still answer an admin", () => {
	test("the reminder settings", async () => {
		const settings = await reminderSettingsService.getForAdmin(adminCtx());
		expect(settings.nudgeWeekdays.length).toBeGreaterThan(0);
	});

	test("the GitHub installations and install URL", async () => {
		expect(await githubService.listInstallations(adminCtx())).toEqual([]);
		const { url } = await githubService.installUrl(adminCtx());
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/apps/farmer-test/installations/new");
		expect(parsed.searchParams.get("state")).toBeTruthy();
	});

	test("the Slack re-match, with nothing installed", async () => {
		expect(await slackService.syncIdentities(adminCtx())).toBe(0);
	});

	test("the organization policy, and a holiday switched off", async () => {
		expect(await orgSettingsService.getForAdmin(adminCtx())).toEqual({
			trackingTolerancePct: 5,
			automationLockedThrough: null,
		});
		await holidaysService.setHolidayDisabled(adminCtx(), {
			name: "New Year's Day",
			disabled: true,
		});
		const year = await holidaysService.listForYearWithStatus(adminCtx(), 2026);
		expect(year.find((day) => day.name === "New Year's Day")?.disabled).toBe(
			true,
		);
	});
});

describe("the assistant settings and threads", () => {
	test("any member reads the settings", async () => {
		const settings = await assistantService.settings.get(plainCtx());
		expect(settings.configured).toBe(false);
	});

	test("a thread is its owner's alone, and anybody else gets not found", async () => {
		const [row] = await db
			.insert(assistantConversation)
			.values({
				organizationId: ORG,
				userId: ADMIN,
				title: "Mine",
				model: "openai/gpt-4o-mini",
			})
			.returning({ id: assistantConversation.id });
		const id = present(row, "the thread").id;

		const own = await assistantService.conversations.get(adminCtx(), id);
		expect(own.conversation.title).toBe("Mine");
		expect(await assistantService.conversations.list(plainCtx())).toEqual([]);

		const refusal = await assistantService.conversations
			.get(plainCtx(), id)
			.then(() => null)
			.catch((error: unknown) => (error instanceof Error ? error : null));
		expect(classifyServiceError(present(refusal, "the refusal")).kind).toBe(
			"not_found",
		);
	});
});
