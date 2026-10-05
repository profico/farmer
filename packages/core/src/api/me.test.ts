// The capabilities that `whoami` sends to the mobile app. The app shows a
// section only when the server says so, so a wrong answer here is a screen that
// is missing or a screen that only ever answers 403. Each case below names the
// role, and the rule it follows is the one the web app already applies.

import { describe, expect, test } from "bun:test";

import { Access } from "../services/access.service";
import { toApiCapabilities } from "./me";

type Role = "member" | "team_lead" | "pm";

const accessWith = (
	roles: [string, Role][],
	{
		isAdmin = false,
		leadOf = [],
	}: { isAdmin?: boolean; leadOf?: string[] } = {},
) => new Access("u1", "org1", isAdmin, new Map(roles), new Set(leadOf));

const NONE = {
	isAdmin: false,
	canManageClients: false,
	canManageProjects: false,
	leadsPeople: false,
	canSeeAllReports: false,
};

describe("toApiCapabilities", () => {
	test("a member has none", () => {
		expect(toApiCapabilities(accessWith([["p1", "member"]]))).toStrictEqual(
			NONE,
		);
		expect(toApiCapabilities(accessWith([]))).toStrictEqual(NONE);
	});

	test("an admin has all but leading people", () => {
		expect(toApiCapabilities(accessWith([], { isAdmin: true }))).toStrictEqual({
			isAdmin: true,
			canManageClients: true,
			canManageProjects: true,
			leadsPeople: false,
			canSeeAllReports: true,
		});
	});

	test("a PM manages clients and projects, but sees no report for everybody", () => {
		expect(toApiCapabilities(accessWith([["p1", "pm"]]))).toStrictEqual({
			...NONE,
			canManageClients: true,
			canManageProjects: true,
		});
	});

	test("a team lead assignment counts the same as a PM assignment", () => {
		expect(toApiCapabilities(accessWith([["p1", "team_lead"]]))).toStrictEqual({
			...NONE,
			canManageClients: true,
			canManageProjects: true,
		});
	});

	// A people list makes a Team Lead. It opens Clients, as the web sidebar
	// does, but it does not let the person create a project on a member row.
	test("a person with a people list and only a member row leads people", () => {
		expect(
			toApiCapabilities(accessWith([["p1", "member"]], { leadOf: ["u2"] })),
		).toStrictEqual({ ...NONE, canManageClients: true, leadsPeople: true });
	});
});
