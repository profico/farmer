import { describe, expect, test } from "bun:test";

import { describeAuditEvent } from "./audit";

describe("describeAuditEvent", () => {
	test("an admin who adds a person names the person", () => {
		expect(describeAuditEvent("member.joined", "Bo Smith")).toBe(
			"added Bo Smith",
		);
	});

	test("a person who joins does not add themselves", () => {
		expect(describeAuditEvent("member.joined", "Bo Smith", true)).toBe(
			"joined the workspace",
		);
	});

	test("a kind without a self sentence keeps its sentence", () => {
		expect(describeAuditEvent("member.archived", "Bo Smith", true)).toBe(
			"archived Bo Smith",
		);
	});
});
