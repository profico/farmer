// Per-person integration toggles.
//
// A missing row is every switch off: connecting GitHub or Google never opts
// anyone into background sync by itself. The `*_since` stamps are the other
// property worth holding — they are the floor the automation window reads, so
// they move only on an off->on transition, clear on on->off, and never move on
// a patch that did not touch that switch.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { db } from "../db";
import { member, organization, user } from "../db/schema/auth";
import { client, project, projectMember } from "../db/schema/domain";
import { createTestDb, present, type TestDb } from "../test/harness";
import { integrationSettingsService } from "./integration-settings.service";
import type { Ctx } from "./types";

const ORG_A = "is-a";
const ORG_B = "is-b";
const ME = "u-is-me";
const COLLEAGUE = "u-is-colleague";

let harness: TestDb;
let trackableProjectId: string;
let unassignedProjectId: string;
let archivedProjectId: string;
let otherOrgProjectId: string;

const ctx = (userId: string, organizationId: string = ORG_A): Ctx => ({
	organizationId,
	userId,
});

const ALL_OFF = {
	googleAutoSyncMeetings: false,
	googleMeetingFallbackProjectId: null,
	githubAutoLoadCommits: false,
	githubSyncCommitsAsWorkTime: false,
	googleAutoSyncMeetingsSince: null,
	githubSyncCommitsAsWorkTimeSince: null,
};

beforeAll(async () => {
	harness = await createTestDb();

	await db.insert(organization).values([
		{ id: ORG_A, name: "Integr A", slug: ORG_A, createdAt: new Date() },
		{ id: ORG_B, name: "Integr B", slug: ORG_B, createdAt: new Date() },
	]);
	await db.insert(user).values(
		[ME, COLLEAGUE].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})),
	);
	await db.insert(member).values([
		{
			id: "m-a-me",
			organizationId: ORG_A,
			userId: ME,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-a-colleague",
			organizationId: ORG_A,
			userId: COLLEAGUE,
			role: "member",
			createdAt: new Date(),
		},
		{
			id: "m-b-me",
			organizationId: ORG_B,
			userId: ME,
			role: "member",
			createdAt: new Date(),
		},
	]);

	const clients = await db
		.insert(client)
		.values([
			{ organizationId: ORG_A, name: "Client One" },
			{ organizationId: ORG_B, name: "Client Two" },
		])
		.returning({ id: client.id, organizationId: client.organizationId });
	const clientIn = (orgId: string) =>
		present(
			clients.find((c) => c.organizationId === orgId),
			"client",
		).id;
	const projects = await db
		.insert(project)
		.values([
			{ organizationId: ORG_A, clientId: clientIn(ORG_A), name: "Project A" },
			{ organizationId: ORG_A, clientId: clientIn(ORG_A), name: "Project B" },
			{
				organizationId: ORG_A,
				clientId: clientIn(ORG_A),
				name: "Project C",
				status: "archived",
			},
			{ organizationId: ORG_B, clientId: clientIn(ORG_B), name: "Project D" },
		])
		.returning({ id: project.id, name: project.name });
	const idOf = (name: string) =>
		present(
			projects.find((p) => p.name === name),
			name,
		).id;
	trackableProjectId = idOf("Project A");
	unassignedProjectId = idOf("Project B");
	archivedProjectId = idOf("Project C");
	otherOrgProjectId = idOf("Project D");
	await db.insert(projectMember).values({
		organizationId: ORG_A,
		projectId: trackableProjectId,
		userId: ME,
		role: "member",
	});
});

afterAll(async () => {
	await harness.close();
});

describe("get", () => {
	test("a missing row is every toggle off and no stamps", async () => {
		expect(await integrationSettingsService.get(ctx(ME))).toEqual(ALL_OFF);
	});
});

describe("update", () => {
	test("turning a switch on stamps it and leaves the others off", async () => {
		const before = Date.now();
		const next = await integrationSettingsService.update(ctx(ME), {
			googleAutoSyncMeetings: true,
		});
		expect(next.googleAutoSyncMeetings).toBe(true);
		expect(next.githubAutoLoadCommits).toBe(false);
		expect(next.githubSyncCommitsAsWorkTime).toBe(false);
		expect(next.githubSyncCommitsAsWorkTimeSince).toBeNull();
		const since = present(next.googleAutoSyncMeetingsSince, "meetings stamp");
		expect(since.getTime()).toBeGreaterThanOrEqual(before - 1000);
	});

	test("a patch of one switch keeps the others and their stamps as stored", async () => {
		const stamp = (await integrationSettingsService.get(ctx(ME)))
			.googleAutoSyncMeetingsSince;
		await Bun.sleep(5);
		const next = await integrationSettingsService.update(ctx(ME), {
			githubAutoLoadCommits: true,
		});
		expect(next.googleAutoSyncMeetings).toBe(true);
		expect(next.googleAutoSyncMeetingsSince).toEqual(stamp);
		expect(next.githubAutoLoadCommits).toBe(true);
	});

	test("re-sending ON for a switch already on does not move its stamp", async () => {
		const stamp = (await integrationSettingsService.get(ctx(ME)))
			.googleAutoSyncMeetingsSince;
		await Bun.sleep(5);
		const next = await integrationSettingsService.update(ctx(ME), {
			googleAutoSyncMeetings: true,
		});
		expect(next.googleAutoSyncMeetingsSince).toEqual(stamp);
	});

	test("off clears the stamp, and on again starts a later one", async () => {
		const first = present(
			(await integrationSettingsService.get(ctx(ME)))
				.googleAutoSyncMeetingsSince,
			"first stamp",
		);
		const off = await integrationSettingsService.update(ctx(ME), {
			googleAutoSyncMeetings: false,
		});
		expect(off.googleAutoSyncMeetings).toBe(false);
		expect(off.googleAutoSyncMeetingsSince).toBeNull();

		await Bun.sleep(5);
		const on = await integrationSettingsService.update(ctx(ME), {
			googleAutoSyncMeetings: true,
		});
		const second = present(on.googleAutoSyncMeetingsSince, "second stamp");
		expect(second.getTime()).toBeGreaterThan(first.getTime());
	});

	test("the commit-work-time switch carries its own stamp", async () => {
		const next = await integrationSettingsService.update(ctx(ME), {
			githubSyncCommitsAsWorkTime: true,
		});
		expect(next.githubSyncCommitsAsWorkTimeSince).not.toBeNull();
	});

	test("settings belong to one person in one org", async () => {
		expect(await integrationSettingsService.get(ctx(COLLEAGUE))).toEqual(
			ALL_OFF,
		);
		expect(await integrationSettingsService.get(ctx(ME, ORG_B))).toEqual(
			ALL_OFF,
		);

		await integrationSettingsService.update(ctx(ME, ORG_B), {
			githubAutoLoadCommits: true,
		});
		const inA = await integrationSettingsService.get(ctx(ME));
		expect(inA.googleAutoSyncMeetings).toBe(true);
		const inB = await integrationSettingsService.get(ctx(ME, ORG_B));
		expect(inB).toEqual({ ...ALL_OFF, githubAutoLoadCommits: true });
	});
});

describe("the fallback project", () => {
	const setFallback = (projectId: string | null) =>
		integrationSettingsService.update(
			{ organizationId: ORG_A, userId: ME },
			{ googleMeetingFallbackProjectId: projectId },
		);

	test("saves a project the person can track on, and null clears it", async () => {
		const saved = await setFallback(trackableProjectId);
		expect(saved.googleMeetingFallbackProjectId).toBe(trackableProjectId);

		// A patch that leaves the field out keeps it.
		const other = await integrationSettingsService.update(ctx(ME), {
			githubAutoLoadCommits: false,
		});
		expect(other.googleMeetingFallbackProjectId).toBe(trackableProjectId);

		const cleared = await setFallback(null);
		expect(cleared.googleMeetingFallbackProjectId).toBeNull();
	});

	test("refuses a project in another org", async () => {
		await expect(setFallback(otherOrgProjectId)).rejects.toThrow(
			"Project not found",
		);
		expect(
			(await integrationSettingsService.get(ctx(ME)))
				.googleMeetingFallbackProjectId,
		).toBeNull();
	});

	test("refuses a project the person cannot track on", async () => {
		await expect(setFallback(unassignedProjectId)).rejects.toThrow(
			"You are not assigned to this project",
		);
	});

	test("refuses an archived project", async () => {
		await expect(setFallback(archivedProjectId)).rejects.toThrow("archived");
	});
});
