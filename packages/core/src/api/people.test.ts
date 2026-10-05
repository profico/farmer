// The People projections. A personnel record goes to an admin only, and a
// column added to `member_profile` must not reach a client by accident, so
// each test hands the projection more than it names.

import { describe, expect, test } from "bun:test";

import type { PersonRow } from "../services/members.service";
import {
	type ApiPerson,
	toApiInvitation,
	toApiPerson,
	toApiPersonProfile,
} from "./people";

const person: PersonRow = {
	userId: "u-1",
	name: "Ana",
	email: "ana@example.com",
	orgRole: "member",
	startDate: "2025-03-01",
	archivedAt: new Date("2026-09-20T10:00:00Z"),
	emailUnconfirmed: false,
	claimPending: false,
	type: "contractor_hourly",
	expectedSecondsOverride: 288_000,
	leadsPeople: 0,
};

const apiPerson: ApiPerson = {
	userId: "u-1",
	name: "Ana",
	email: "ana@example.com",
	orgRole: "member",
	type: "contractor_hourly",
	expectedSecondsOverride: 288_000,
	startDate: "2025-03-01",
	archivedAt: "2026-09-20T10:00:00.000Z",
	emailUnconfirmed: false,
	claimPending: false,
	leadsPeople: 0,
};

describe("toApiPerson", () => {
	test("keeps exactly the fields it names", () => {
		expect(toApiPerson({ ...person, ...{ secretNote: "x" } })).toStrictEqual(
			apiPerson,
		);
	});
});

describe("toApiPersonProfile", () => {
	test("drops the columns of the history rows it does not name", () => {
		const profile = toApiPersonProfile({
			person,
			typeHistory: [
				{
					type: "employee_billable",
					expectedSecondsOverride: null,
					effectiveFrom: "2025-03-01",
					effectiveUntil: "2026-01-01",
					...{ id: "h-1", organizationId: "org-1", userId: "u-1" },
				},
			],
			leads: [{ userId: "u-2", name: "Ben", email: "ben@example.com" }],
		});
		expect(profile).toStrictEqual({
			person: apiPerson,
			typeHistory: [
				{
					type: "employee_billable",
					expectedSecondsOverride: null,
					effectiveFrom: "2025-03-01",
					effectiveUntil: "2026-01-01",
				},
			],
			leads: [{ userId: "u-2", name: "Ben", email: "ben@example.com" }],
		});
	});
});

describe("toApiInvitation", () => {
	test("sends the dates as ISO 8601 and keeps the email state", () => {
		expect(
			toApiInvitation({
				id: "i-1",
				email: "new@example.com",
				role: "member",
				status: "pending",
				expiresAt: new Date("2026-10-13T08:00:00Z"),
				createdAt: new Date("2026-10-06T08:00:00Z"),
				emailDelivery: { status: "failed", error: "No mail server" },
				...{ inviterId: "u-9", organizationId: "org-1" },
			}),
		).toStrictEqual({
			id: "i-1",
			email: "new@example.com",
			role: "member",
			status: "pending",
			expiresAt: "2026-10-13T08:00:00.000Z",
			createdAt: "2026-10-06T08:00:00.000Z",
			emailDelivery: { status: "failed", error: "No mail server" },
		});
	});
});
