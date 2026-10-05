// The projections of `/api/v1/me/...`: each one keeps the fields it names,
// with each instant as ISO text.

import { describe, expect, test } from "bun:test";

import { toApiImportClaim, toApiMyInvitation } from "./onboarding";

const at = new Date("2026-10-06T09:15:00Z");

describe("toApiMyInvitation", () => {
	test("groups the organization and keeps the rest", () => {
		expect(
			toApiMyInvitation({
				id: "i-1",
				role: "member",
				organizationId: "org-1",
				organizationName: "Profico",
				expiresAt: at,
			}),
		).toStrictEqual({
			id: "i-1",
			role: "member",
			organization: { id: "org-1", name: "Profico" },
			expiresAt: "2026-10-06T09:15:00.000Z",
		});
	});
});

describe("toApiImportClaim", () => {
	test("keeps the organization and the date of the import", () => {
		expect(
			toApiImportClaim({
				organizationId: "org-1",
				name: "Profico",
				slug: "profico",
				logo: null,
				since: at,
			}),
		).toStrictEqual({
			organizationId: "org-1",
			name: "Profico",
			slug: "profico",
			logo: null,
			since: "2026-10-06T09:15:00.000Z",
		});
	});
});
