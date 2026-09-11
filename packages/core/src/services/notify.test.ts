// Who gets told what, pinned.
//
// None of this was testable before: the policy was spread across four jobs, and
// the push path took a bare user id, so "don't contact someone who left the
// organization" was not a rule any test could reach — it was a property of what
// the callers happened to be iterating.

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";

import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { account, member, organization, user } from "../db/schema/auth";
import { notificationSettings } from "../db/schema/notifications";
import { createTestDb, type TestDb } from "../test/harness";
import {
	type NotifyAdapter,
	type NotifyChannel,
	notify,
	setNotifyAdaptersForTests,
	slackText,
	wasDelivered,
} from "./notify";

const ORG = "org-notify";
const OTHER_ORG = "org-notify-other";
const MEMBER = "user-member";
const OUTSIDER = "user-outsider";

let harness: TestDb;

/** Records every send instead of making one, and can be told to fail. */
const recorder = () => {
	const calls: { channel: NotifyChannel; text: string }[] = [];
	const adapter =
		(
			channel: NotifyChannel,
			behaviour: "ok" | "false" | "throw" = "ok",
		): NotifyAdapter =>
		async (_to, event) => {
			calls.push({ channel, text: `${event.title ?? ""}|${event.body}` });
			if (behaviour === "throw") throw new Error(`${channel} exploded`);
			return behaviour === "ok";
		};
	return { calls, adapter };
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG, name: "Notify Org", slug: ORG, createdAt: new Date() },
		{ id: OTHER_ORG, name: "Other", slug: OTHER_ORG, createdAt: new Date() },
	]);
	await db.insert(user).values([
		{
			id: MEMBER,
			name: "Member",
			email: "m@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
		{
			id: OUTSIDER,
			name: "Outsider",
			email: "o@example.com",
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		},
	]);
	await db.insert(member).values([
		{
			id: "m1",
			organizationId: ORG,
			userId: MEMBER,
			role: "member",
			createdAt: new Date(),
		},
		// The outsider is a member of a DIFFERENT org — the case a bare user id
		// cannot distinguish.
		{
			id: "m2",
			organizationId: OTHER_ORG,
			userId: OUTSIDER,
			role: "member",
			createdAt: new Date(),
		},
	]);
	// Somebody who has signed in. The reminder kinds skip a person with no
	// `account` row by default (see "the reminder gates" below), and every
	// other test here is about something else.
	await db.insert(account).values({
		id: "acc-member",
		accountId: MEMBER,
		providerId: "credential",
		userId: MEMBER,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
});

afterEach(async () => {
	setNotifyAdaptersForTests();
	await db
		.delete(notificationSettings)
		.where(eq(notificationSettings.organizationId, ORG));
});

afterAll(async () => {
	await harness.close();
});

describe("the membership rule", () => {
	test("a member is reached", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({ slack: r.adapter("slack") });
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "compliance-nudge", body: "log your hours" },
		);
		expect(outcome.slack).toBe(true);
		expect(r.calls).toHaveLength(1);
	});

	// The defect the old signature made unreachable: `notifyUser(userId, ...)`
	// had no organization to check against.
	test("someone who belongs to another org is not", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({
			slack: r.adapter("slack"),
			push: r.adapter("push"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: OUTSIDER },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(outcome).toEqual({ push: false, slack: false });
		expect(r.calls).toHaveLength(0);
	});

	test("a user who exists nowhere is not", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({ slack: r.adapter("slack") });
		await notify(
			{ organizationId: ORG, userId: "no-such-user" },
			{ kind: "compliance-nudge", body: "x" },
		);
		expect(r.calls).toHaveLength(0);
	});
});

describe("the preference gate", () => {
	test("a kind with no preference always goes out", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({ slack: r.adapter("slack") });
		await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "compliance-nudge", body: "x" },
		);
		expect(r.calls).toHaveLength(1);
	});

	// A missing settings row is the default, and the default is ON.
	test("log reminders default to on", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({ push: r.adapter("push") });
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "log-reminder", title: "Log your hours", body: "x" },
		);
		expect(outcome.push).toBe(true);
	});

	test("turning them off silences the kind on every channel", async () => {
		await db.insert(notificationSettings).values({
			organizationId: ORG,
			userId: MEMBER,
			logReminders: false,
		});
		const r = recorder();
		setNotifyAdaptersForTests({
			push: r.adapter("push"),
			slack: r.adapter("slack"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "log-reminder", title: "Log your hours", body: "x" },
		);
		expect(wasDelivered(outcome)).toBe(false);
		expect(r.calls).toHaveLength(0);
	});

	// The preference is per (org, user): it must not follow the person across
	// organizations.
	test("it does not silence a different kind", async () => {
		await db.insert(notificationSettings).values({
			organizationId: ORG,
			userId: MEMBER,
			logReminders: false,
		});
		const r = recorder();
		setNotifyAdaptersForTests({
			push: r.adapter("push"),
			slack: r.adapter("slack"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(wasDelivered(outcome)).toBe(true);
	});
});

describe("the fan-out", () => {
	test("a budget alert goes to both channels", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({
			push: r.adapter("push"),
			slack: r.adapter("slack"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(outcome).toEqual({ push: true, slack: true });
		expect(r.calls.map((c) => c.channel).sort()).toEqual(["push", "slack"]);
	});

	test("a log reminder is push only", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({
			push: r.adapter("push"),
			slack: r.adapter("slack"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "log-reminder", title: "Log your hours", body: "x" },
		);
		expect(outcome).toEqual({ push: true, slack: false });
		expect(r.calls.map((c) => c.channel)).toEqual(["push"]);
	});

	// The reason this is a seam and not a helper: a dead push endpoint must not
	// take the Slack DM down with it, and neither may reach the caller.
	test("one channel throwing does not stop the other", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({
			push: r.adapter("push", "throw"),
			slack: r.adapter("slack"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(outcome).toEqual({ push: false, slack: true });
		expect(wasDelivered(outcome)).toBe(true);
	});

	test("every channel failing is reported, not thrown", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({
			push: r.adapter("push", "throw"),
			slack: r.adapter("slack", "false"),
		});
		const outcome = await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(outcome).toEqual({ push: false, slack: false });
		expect(wasDelivered(outcome)).toBe(false);
	});
});

describe("what the channels are handed", () => {
	test("a title is joined onto the body", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({ slack: r.adapter("slack") });
		await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "budget-alert", title: "Over budget", body: "detail" },
		);
		expect(r.calls[0]?.text).toBe("Over budget|detail");
	});

	// The Slack-only kinds are single sentences that never had a headline; the
	// seam must not invent one, or every nudge gains a prefix.
	test("a kind with no title passes the body through untouched", async () => {
		const r = recorder();
		setNotifyAdaptersForTests({ slack: r.adapter("slack") });
		await notify(
			{ organizationId: ORG, userId: MEMBER },
			{ kind: "compliance-nudge", body: "You haven't logged anything since." },
		);
		expect(r.calls[0]?.text).toBe("|You haven't logged anything since.");
	});
});

describe("the Slack text", () => {
	const origin = process.env.BETTER_AUTH_URL;
	afterAll(() => {
		if (origin === undefined) delete process.env.BETTER_AUTH_URL;
		else process.env.BETTER_AUTH_URL = origin;
	});

	test("puts the title in bold on its own line and escapes both", () => {
		expect(
			slackText({ kind: "budget-alert", title: "A & B", body: "<b> over" }),
		).toBe("*A &amp; B*\n&lt;b&gt; over");
	});

	test("ends with the deep link on the app's own origin", () => {
		process.env.BETTER_AUTH_URL = "https://farmer.example";
		expect(
			slackText({
				kind: "compliance-nudge",
				body: "x",
				url: "/acme/reports?tab=budget",
				linkLabel: "Open Budget burn",
			}),
		).toBe(
			"x\n<https://farmer.example/acme/reports?tab=budget|Open Budget burn>",
		);
	});

	test("leaves the link out when the origin is not configured", () => {
		delete process.env.BETTER_AUTH_URL;
		expect(slackText({ kind: "compliance-nudge", body: "x", url: "/a" })).toBe(
			"x",
		);
	});

	test("sends a mrkdwn form as it is, instead of the title and body", () => {
		delete process.env.BETTER_AUTH_URL;
		expect(
			slackText({
				kind: "admin-digest",
				title: "Plain",
				body: "plain",
				slack: "*Rich* <@U1>",
			}),
		).toBe("*Rich* <@U1>");
	});
});

describe("wasDelivered", () => {
	test("is true when any channel got through", () => {
		expect(wasDelivered({ push: false, slack: true })).toBe(true);
		expect(wasDelivered({ push: true, slack: false })).toBe(true);
	});

	test("is false when none did", () => {
		expect(wasDelivered({ push: false, slack: false })).toBe(false);
	});
});

describe("settings are scoped to the organization", () => {
	test("a row for one org does not gate another", async () => {
		await db.insert(notificationSettings).values({
			organizationId: ORG,
			userId: MEMBER,
			logReminders: false,
		});
		const row = await db.query.notificationSettings.findFirst({
			where: and(
				eq(notificationSettings.organizationId, ORG),
				eq(notificationSettings.userId, MEMBER),
			),
		});
		expect(row?.logReminders).toBe(false);

		// Same person, other org, no row: the default still applies there.
		const other = await db.query.notificationSettings.findFirst({
			where: and(
				eq(notificationSettings.organizationId, OTHER_ORG),
				eq(notificationSettings.userId, MEMBER),
			),
		});
		expect(other).toBeUndefined();
	});
});
