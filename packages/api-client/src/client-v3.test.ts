// The routes of API version 3: the Day view's helpers, GitHub on an entry,
// the admin's policy and images, and the steps before a workspace. Each test
// checks the path and the body the client sends, and that the answer parses.

import { describe, expect, test } from "bun:test";

import { FarmerClient } from "./client";
import { ApiClientError } from "./errors";
import { ORIGIN, jsonReply, scriptedServer } from "./test-server";

const failureOf = async (promise: Promise<object | void>) => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof ApiClientError) return error;
		throw error;
	}
	throw new Error("The call did not fail.");
};

const timeEntry = {
	id: "e-1",
	date: "2026-10-06",
	durationSeconds: 1800,
	description: "Stand-up",
	overtime: false,
	fillsDay: false,
	synced: true,
	commitCount: 0,
	task: { id: "t-1", name: "Meeting", isAbsence: false },
	project: null,
};

describe("the Day view's helpers", () => {
	test("day assembly sends its query, and a new kind still parses", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, {
				date: "2026-10-06",
				targetSeconds: 28_800,
				loggedSeconds: 0,
				suggestions: [
					{
						key: "focus",
						kind: "focus",
						taskId: "t-1",
						taskName: "Development",
						projectId: null,
						projectName: null,
						description: "",
						durationSeconds: 3600,
						fillsDay: false,
						meetingUrl: null,
						calendarEventId: null,
						commits: [],
						pullRequests: [],
						dismissed: false,
					},
				],
				sources: { calendar: "ok", github: "unavailable" },
				dismissedCount: 0,
			}),
		]);
		const assembly = await new FarmerClient(
			transport,
			"tok",
		).suggestDayAssembly("acme", {
			date: "2026-10-06",
			includeDismissed: true,
		});
		expect(assembly.suggestions[0]?.kind).toBe("focus");
		expect(requests[0]?.url).toBe(
			`${ORIGIN}/api/v1/orgs/acme/day-assembly?date=2026-10-06&includeDismissed=true`,
		);
	});

	test("an entry from before API version 3 has no calendar notice", async () => {
		const { transport } = scriptedServer([
			jsonReply(200, timeEntry),
			jsonReply(200, {
				...timeEntry,
				calendarChange: {
					changedAt: "2026-10-06T10:00:00.000Z",
					from: { durationSeconds: 900 },
					calendar: { date: "2026-10-06", durationSeconds: 2700 },
				},
			}),
		]);
		const client = new FarmerClient(transport, "tok");
		const before = await client.useCalendarValues("acme", "e-1");
		expect(before.calendarChange).toBeUndefined();
		const after = await client.dismissCalendarChange("acme", "e-1");
		expect(after.calendarChange?.calendar?.durationSeconds).toBe(2700);
	});

	test("a detach names the entry and the attachment in the path", async () => {
		const { transport, requests } = scriptedServer([jsonReply(200, [])]);
		const left = await new FarmerClient(transport, "tok").detachCommit(
			"acme",
			"e-1",
			"c/1",
		);
		expect(left).toStrictEqual([]);
		expect(requests[0]?.method).toBe("DELETE");
		expect(requests[0]?.url).toBe(
			`${ORIGIN}/api/v1/orgs/acme/time-entries/e-1/commits/c%2F1`,
		);
	});

	test("an attach sends the commits as JSON", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, [
				{
					id: "c-1",
					sha: "abc1234",
					message: "Fix login",
					authorLogin: null,
					committedAt: "2026-10-06T09:00:00.000Z",
					url: "https://github.com/x",
					repoFullName: null,
				},
			]),
		]);
		const commits = await new FarmerClient(transport, "tok").attachCommits(
			"acme",
			"e-1",
			{ commits: [{ projectGithubRepoId: "r-1", sha: "abc1234" }] },
		);
		expect(commits[0]?.repoFullName).toBeNull();
		expect(requests[0]?.body).toBe(
			JSON.stringify({
				commits: [{ projectGithubRepoId: "r-1", sha: "abc1234" }],
			}),
		);
	});
});

describe("the admin's routes", () => {
	test("an upload sends base64 and answers the path", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, { url: "/api/files/org/logo.png" }),
		]);
		const image = await new FarmerClient(transport, "tok").uploadImage("acme", {
			purpose: "org-logo",
			data: "iVBORw0KGgo=",
		});
		expect(image.url).toBe("/api/files/org/logo.png");
		expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/orgs/acme/uploads`);
	});

	test("a refusal of a member keeps the server's sentence", async () => {
		const { transport } = scriptedServer([
			jsonReply(403, { error: "Admins only.", code: "forbidden" }),
		]);
		const error = await failureOf(
			new FarmerClient(transport, "tok").getOrgPolicy("acme"),
		);
		expect(error.code).toBe("forbidden");
		expect(error.status).toBe(403);
		expect(error.message).toBe("Admins only.");
	});
});

describe("the steps before a workspace", () => {
	test("the invitations are read outside an organization", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, [
				{
					id: "i-1",
					role: "member",
					organization: { id: "org-1", name: "Acme" },
					expiresAt: "2026-10-08T00:00:00.000Z",
				},
			]),
		]);
		const invitations = await new FarmerClient(
			transport,
			"tok",
		).listMyInvitations();
		expect(invitations[0]?.organization.name).toBe("Acme");
		expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/me/invitations`);
	});

	test("an accept answers the workspace to open", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, { organizationId: "org-1", slug: "acme" }),
		]);
		const joined = await new FarmerClient(transport, "tok").acceptInvitation(
			"i-1",
		);
		expect(joined.slug).toBe("acme");
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.url).toBe(`${ORIGIN}/api/v1/me/invitations/i-1/accept`);
	});

	test("a new workspace may leave out the defaults", async () => {
		const { transport, requests } = scriptedServer([
			jsonReply(200, { id: "org-2", name: "Studio", slug: "studio" }),
		]);
		const created = await new FarmerClient(transport, "tok").createOrganization(
			{ name: "Studio" },
		);
		expect(created.slug).toBe("studio");
		expect(requests[0]?.body).toBe(JSON.stringify({ name: "Studio" }));
	});
});
