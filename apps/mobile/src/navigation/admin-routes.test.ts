/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";

import { adminGate, isAdminRoute } from "./admin-routes";

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
