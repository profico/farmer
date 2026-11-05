// The workspace admin projections: each one keeps the fields it names and
// nothing that the row carries beside them.

import { describe, expect, test } from "bun:test";

import {
	toApiHourFundMonth,
	toApiManagedTask,
	toApiOrgPolicy,
	toApiOrganizationSettings,
} from "./workspace-admin";

const createdAt = new Date("2026-09-14T08:00:00Z");

describe("toApiManagedTask", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "t-1",
			name: "Design",
			group: "product",
			isAbsence: false,
			systemKey: null,
			scope: "organization",
			organizationId: "org-1",
			color: "#336699",
			description: "Screens and flows",
			archivedAt: new Date("2026-09-20T10:00:00Z"),
			entryCount: 4,
			createdAt,
			updatedAt: createdAt,
		};
		expect(toApiManagedTask(row)).toStrictEqual({
			id: "t-1",
			name: "Design",
			group: "product",
			isAbsence: false,
			systemKey: null,
			scope: "organization",
			color: "#336699",
			description: "Screens and flows",
			archivedAt: "2026-09-20T10:00:00.000Z",
			entryCount: 4,
		});
	});
});

describe("toApiHourFundMonth", () => {
	test("keeps the month and the fund only", () => {
		const row = {
			id: "f-1",
			organizationId: "org-1",
			year: 2026,
			month: 10,
			fundSeconds: 633_600,
			createdAt,
			updatedAt: createdAt,
		};
		expect(toApiHourFundMonth(row)).toStrictEqual({
			year: 2026,
			month: 10,
			fundSeconds: 633_600,
		});
	});
});

describe("toApiOrganizationSettings", () => {
	test("keeps the five settings only", () => {
		const settings = {
			name: "Profico",
			country: "HR",
			timezone: "Europe/Zagreb",
			weekStartsOn: 1 as const,
			logo: null,
		};
		expect(
			toApiOrganizationSettings({ ...settings, ...{ slug: "profico" } }),
		).toStrictEqual(settings);
	});
});

describe("toApiOrgPolicy", () => {
	test("keeps the two policies only", () => {
		const policy = {
			trackingTolerancePct: 10,
			automationLockedThrough: "2026-09-30",
		};
		expect(
			toApiOrgPolicy({ ...policy, ...{ organizationId: "org-1" } }),
		).toStrictEqual(policy);
	});
});
