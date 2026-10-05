// The clients projection, for the reason `time-entries.test.ts` gives: a column
// added to `client` next month must not become a field that a mobile app
// starts to depend on.

import { describe, expect, test } from "bun:test";

import { toApiClient } from "./catalogue";

describe("toApiClient", () => {
	test("keeps exactly the fields it names", () => {
		const row = {
			id: "c-1",
			name: "Acme",
			isInternal: false,
			organizationId: "org-1",
			archivedAt: null,
			createdAt: new Date("2026-09-14T08:00:00Z"),
		};
		expect(toApiClient(row)).toStrictEqual({
			id: "c-1",
			name: "Acme",
			isInternal: false,
		});
	});
});
