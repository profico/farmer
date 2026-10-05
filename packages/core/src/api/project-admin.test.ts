// The projections of the PM and team lead screens, for the reason that
// `time-entries.test.ts` gives: a column added to a table must not become a
// field that the mobile app starts to depend on.

import { describe, expect, test } from "bun:test";

import {
	toApiPersonRef,
	toApiProjectDetail,
	toApiProjectMember,
	toApiProjectOverview,
} from "./project-admin";

const createdAt = new Date("2026-09-14T08:00:00Z");

/** A row shaped like `enrichedProjects`: the project, its client, the
 *  caller's role and the stats, and more. */
const projectRow = () => ({
	id: "p-1",
	organizationId: "org-1",
	name: "Website",
	code: "WEB",
	status: "active",
	type: "fixed_scope",
	icon: null,
	openToOrg: false,
	budgetSeconds: 360_000,
	budgetAmount: "15000.00",
	hourlyPrice: null,
	clientId: "c-1",
	client: {
		id: "c-1",
		name: "Acme",
		isInternal: false,
		organizationId: "org-1",
		archivedAt: null,
	},
	myRole: "pm" as const,
	statsScope: "project" as const,
	monthlyTotalSeconds: 7200,
	allTimeSeconds: 36_000,
	contributorCount: 2,
	contributors: [
		{ id: "u-1", name: "Ana", email: "ana@example.com" },
		{ id: "u-2", name: "Ben", email: "ben@example.com" },
	],
	createdAt,
	updatedAt: createdAt,
});

describe("toApiProjectDetail", () => {
	test("keeps exactly the fields it names", () => {
		expect(toApiProjectDetail(projectRow())).toStrictEqual({
			id: "p-1",
			name: "Website",
			code: "WEB",
			status: "active",
			client: { id: "c-1", name: "Acme" },
			role: "pm",
			type: "fixed_scope",
			icon: null,
			openToOrg: false,
			budgetSeconds: 360_000,
			budgetAmount: "15000.00",
			hourlyPrice: null,
			stats: {
				scope: "project",
				monthSeconds: 7200,
				allTimeSeconds: 36_000,
				contributorCount: 2,
				contributors: [
					{ id: "u-1", name: "Ana" },
					{ id: "u-2", name: "Ben" },
				],
			},
		});
	});

	// The service already sets the money to null for a member. The projection
	// must not fill it in from anywhere else.
	test("passes the redacted money through as null", () => {
		const row = {
			...projectRow(),
			budgetSeconds: null,
			budgetAmount: null,
			hourlyPrice: null,
			myRole: "member" as const,
			statsScope: "own" as const,
			contributorCount: 0,
			contributors: [],
		};
		const detail = toApiProjectDetail(row);
		expect(detail.budgetSeconds).toBeNull();
		expect(detail.budgetAmount).toBeNull();
		expect(detail.hourlyPrice).toBeNull();
		expect(detail.stats.scope).toBe("own");
	});
});

describe("the team projections", () => {
	test("a team row keeps only its own fields", () => {
		const row = {
			userId: "u-1",
			name: "Ana",
			email: "ana@example.com",
			role: "team_lead" as const,
			active: true,
			allTimeSeconds: 3600,
			lastEntry: "2026-09-12",
			organizationId: "org-1",
			projectId: "p-1",
		};
		expect(toApiProjectMember(row)).toStrictEqual({
			userId: "u-1",
			name: "Ana",
			email: "ana@example.com",
			role: "team_lead",
			active: true,
			allTimeSeconds: 3600,
			lastEntry: "2026-09-12",
		});
	});

	test("a person reference is the name and the address only", () => {
		const row = {
			userId: "u-1",
			name: "Ana",
			email: "ana@example.com",
			image: "https://example.com/ana.png",
		};
		expect(toApiPersonRef(row)).toStrictEqual({
			userId: "u-1",
			name: "Ana",
			email: "ana@example.com",
		});
	});

	test("the overview keeps its eight figures", () => {
		const overview = {
			allTimeSeconds: 36_000,
			entryCount: 12,
			peopleCount: 3,
			firstEntry: "2026-01-05",
			lastEntry: "2026-09-12",
			overtimeSeconds: 0,
			monthSeconds: 7200,
			monthPeople: 2,
		};
		expect(
			toApiProjectOverview({ ...overview, ...{ extra: 1 } }),
		).toStrictEqual(overview);
	});
});
