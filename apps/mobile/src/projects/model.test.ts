import { describe, expect, test } from "bun:test";

/// <reference types="bun-types" />
import type { ProjectDetail } from "@farmer/api-client";

import { canActOnProjectRole, projectPageAccess } from "./access";
import {
	EMPTY_FORM,
	formatAge,
	formOf,
	groupByClient,
	markOf,
	newProjectOf,
	patchOf,
	validateForm,
} from "./model";

const project = (
	id: string,
	client: string,
	monthSeconds: number,
	patch: Partial<ProjectDetail> = {},
): ProjectDetail => ({
	id,
	name: id,
	code: null,
	status: "active",
	client: { id: client, name: client },
	role: "pm",
	type: "fixed_scope",
	icon: null,
	openToOrg: false,
	budgetSeconds: 400 * 3600,
	budgetAmount: "32000",
	hourlyPrice: null,
	stats: {
		scope: "project",
		monthSeconds,
		allTimeSeconds: monthSeconds,
		contributorCount: 0,
		contributors: [],
	},
	...patch,
});

describe("who may do what on a project", () => {
	test("a member logs time, a lead runs the team, a PM the settings", () => {
		expect(projectPageAccess(false, "member")).toEqual({
			canView: false,
			canManageTeam: false,
			canManageSettings: false,
			canLogTime: true,
		});
		expect(projectPageAccess(false, "team_lead").canManageSettings).toBe(false);
		expect(projectPageAccess(false, "team_lead").canManageTeam).toBe(true);
		expect(projectPageAccess(false, "pm").canManageSettings).toBe(true);
		expect(projectPageAccess(false, null).canLogTime).toBe(false);
		expect(projectPageAccess(false, null, true).canLogTime).toBe(true);
		expect(projectPageAccess(true, null).canManageSettings).toBe(true);
	});

	test("nobody acts above their own rank, except an admin", () => {
		expect(canActOnProjectRole(false, "team_lead", "member")).toBe(true);
		expect(canActOnProjectRole(false, "team_lead", "team_lead")).toBe(true);
		expect(canActOnProjectRole(false, "team_lead", "pm")).toBe(false);
		expect(canActOnProjectRole(false, "pm", "pm")).toBe(true);
		expect(canActOnProjectRole(false, null, "member")).toBe(false);
		expect(canActOnProjectRole(true, null, "pm")).toBe(true);
	});
});

describe("the list of projects", () => {
	const list = [
		project("Zeta", "Acme", 3600),
		project("Alpha", "Acme", 7200),
		project("Beta", "Bolt", 36000),
	];

	test("by hours, the busiest client and project are first", () => {
		const groups = groupByClient(list, "month");
		expect(groups.map((group) => group.name)).toEqual(["Bolt", "Acme"]);
		expect(groups[1]?.projects.map((item) => item.name)).toEqual([
			"Alpha",
			"Zeta",
		]);
		expect(groups[1]?.monthSeconds).toBe(10800);
	});

	test("by name, everything is in alphabetical order", () => {
		const groups = groupByClient(list, "name");
		expect(groups.map((group) => group.name)).toEqual(["Acme", "Bolt"]);
		expect(groups[0]?.projects.map((item) => item.name)).toEqual([
			"Alpha",
			"Zeta",
		]);
	});

	test("the mark is the emoji, else the first letter", () => {
		expect(markOf("🚜", "Farm")).toBe("🚜");
		expect(markOf(null, " farm")).toBe("F");
		expect(
			markOf(
				"/api/files/orgs/acme/project-icon/0b8a3c4e-1d2f-4a5b-8c6d-7e8f9a0b1c2d.png",
				"Farm",
			),
		).toBe("F");
	});
});

describe("the project form", () => {
	test("the errors use the words of the web form", () => {
		expect(validateForm(EMPTY_FORM)).toEqual({
			name: "Required",
			clientId: "Required",
		});
		expect(
			validateForm({
				...EMPTY_FORM,
				name: "Site",
				clientId: "c1",
				type: "fixed_scope",
				budgetHours: "0",
				budgetAmount: "12.345",
			}),
		).toEqual({
			budgetHours: "Must be 1 to 100,000",
			budgetAmount: "Must be an amount",
		});
	});

	test("a new project sends only the money of its type", () => {
		expect(
			newProjectOf({
				...EMPTY_FORM,
				name: " Site ",
				clientId: "c1",
				type: "hourly",
				budgetHours: "40",
				hourlyPrice: "85",
			}),
		).toEqual({
			name: "Site",
			code: undefined,
			clientId: "c1",
			type: "hourly",
			icon: null,
			budgetHours: undefined,
			budgetAmount: undefined,
			hourlyPrice: "85",
		});
	});

	test("a rename sends only the name", () => {
		const before = formOf(project("Site", "Acme", 0));
		expect(patchOf(before, { ...before, name: "Web" })).toEqual({
			name: "Web",
		});
		expect(patchOf(before, before)).toEqual({});
	});

	test("a change of the budget sends the type and its money", () => {
		const before = formOf(project("Site", "Acme", 0));
		expect(before.budgetHours).toBe("400");
		expect(patchOf(before, { ...before, budgetHours: "500" })).toEqual({
			type: "fixed_scope",
			budgetHours: 500,
			budgetAmount: "32000",
			hourlyPrice: undefined,
		});
	});
});

describe("formatAge", () => {
	const at = "2026-10-06T12:00:00.000Z";
	const now = Date.parse(at);
	test("counts minutes, hours and days, as the web does", () => {
		expect(formatAge(at, now + 30_000)).toBe("just now");
		expect(formatAge(at, now + 12 * 60_000)).toBe("12 min ago");
		expect(formatAge(at, now + 3 * 3_600_000)).toBe("3 h ago");
		expect(formatAge(at, now + 50 * 3_600_000)).toBe("2 d ago");
	});
});
