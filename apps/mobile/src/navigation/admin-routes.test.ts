/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
	ADMIN_SECTIONS,
	adminGate,
	isAdminRoute,
	MEMBER_SECTIONS,
} from "./admin-routes";

describe("the route files of the workspace", () => {
	test("every section is classified as admin or member", () => {
		const dir = join(import.meta.dir, "../../app/workspace");
		const sections = readdirSync(dir, { withFileTypes: true })
			.map((entry) => entry.name.replace(/\.tsx?$/, ""))
			.filter((name) => name !== "_layout");
		expect(sections.length).toBeGreaterThan(0);
		for (const section of sections) {
			const known = ADMIN_SECTIONS.has(section) || MEMBER_SECTIONS.has(section);
			if (!known) throw new Error(`Unclassified workspace section: ${section}`);
		}
	});

	test("no section is both admin and member", () => {
		for (const section of ADMIN_SECTIONS) {
			expect(MEMBER_SECTIONS.has(section)).toBe(false);
		}
	});
});

describe("isAdminRoute", () => {
	test("the admin sections and their screens", () => {
		for (const route of [
			["workspace", "people"],
			["workspace", "people", "invite"],
			["workspace", "people", "[userId]", "team"],
			["workspace", "reminders", "preview"],
			["workspace", "webhooks", "[id]", "edit"],
			["workspace", "audit-log", "retention"],
			["workspace", "integrations", "slack-test"],
			["workspace", "organization", "timezone"],
		]) {
			expect(isAdminRoute(route)).toBe(true);
		}
	});

	test("the client list, other roots and the layout itself are open", () => {
		expect(isAdminRoute(["workspace", "clients"])).toBe(false);
		expect(isAdminRoute(["workspace"])).toBe(false);
		expect(isAdminRoute(["(tabs)", "more"])).toBe(false);
		expect(isAdminRoute(["you", "integrations"])).toBe(false);
	});
});

describe("adminGate", () => {
	const people = ["workspace", "people", "invite"];

	test("an admin passes", () => {
		expect(adminGate(people, { ready: true, isAdmin: true })).toBe("show");
	});

	test("a member is redirected once the capabilities are read", () => {
		expect(adminGate(people, { ready: true, isAdmin: false })).toBe("redirect");
	});

	test("a route waits while the capabilities load", () => {
		expect(adminGate(people, { ready: false, isAdmin: false })).toBe("wait");
	});

	test("a member passes on a route that is not for admins", () => {
		const clients = ["workspace", "clients"];
		expect(adminGate(clients, { ready: true, isAdmin: false })).toBe("show");
	});
});
