import { z } from "zod";

import { dayKeySchema } from "./day-key";

export const inviteMemberInput = z.object({
	email: z.email(),
	role: z.enum(["admin", "member"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

// better-auth owns the invitation row and generates its id with its own
// generator, not as a UUID — the column is `text`, so anything narrower than a
// non-empty string rejects a valid id.
// An invitation that the caller answers: accept or decline. Only the id. The
// person is always the session's own user.
export const answerInvitationInput = z.object({
	invitationId: z.string().min(1).max(64),
});
export type AnswerInvitationInput = z.infer<typeof answerInvitationInput>;

export const cancelInvitationInput = z.string().min(1);
export type CancelInvitationInput = z.infer<typeof cancelInvitationInput>;

// The same better-auth invitation id.
export const resendInvitationInput = z.string().min(1);
export type ResendInvitationInput = z.infer<typeof resendInvitationInput>;

// better-auth's removeMember accepts either the member row id or the
// member's email — can't narrow further than "non-empty string".
export const removeMemberInput = z.string().min(1);
export type RemoveMemberInput = z.infer<typeof removeMemberInput>;

export const updateMemberRoleInput = z.object({
	// Same as cancelInvitationInput: a better-auth id, not a UUID.
	memberId: z.string().min(1),
	role: z.enum(["admin", "member"]),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInput>;

// Three kinds of person, each with one attribute (PRD 3.1, revised Sept 2026):
// an employee is billable or overhead; a student or a contractor is full-time
// or hourly. Billable and full-time people carry the monthly hour fund as their
// Expected; overhead people never do and are never reminded; hourly people have
// no fund and only an explicit monthly figure, if one is set.
export const memberTypeEnum = z.enum([
	"employee_billable",
	"employee_overhead",
	"student_full_time",
	"student_hourly",
	"contractor_full_time",
	"contractor_hourly",
]);
export type MemberTypeValue = z.infer<typeof memberTypeEnum>;

/** Hourly people have no monthly fund; an explicit override is their only
 *  Expected figure. */
export const isHourlyMemberType = (type: MemberTypeValue): boolean =>
	type === "student_hourly" || type === "contractor_hourly";

export const MEMBER_TYPE_LABELS = {
	employee_billable: "Employee · Billable",
	employee_overhead: "Employee · Overhead",
	student_full_time: "Student · Full-time",
	student_hourly: "Student · Hourly",
	contractor_full_time: "Contractor · Full-time",
	contractor_hourly: "Contractor · Hourly",
} satisfies Record<MemberTypeValue, string>;

// Type changes are effective-dated so past months keep reporting the type the
// person actually held then (PRD 3.1).
export const setMemberTypeInput = z
	.object({
		userId: z.string().min(1),
		type: memberTypeEnum,
		// Only meaningful for hourly people: an explicit monthly expected value, in
		// seconds. Everyone else derives Expected from the org's monthly hour fund.
		expectedSecondsOverride: z
			.number()
			.int()
			.min(0)
			.max(400 * 3600)
			.nullable()
			.optional(),
		effectiveFrom: dayKeySchema,
	})
	.refine(
		(data) =>
			isHourlyMemberType(data.type) || data.expectedSecondsOverride == null,
		{
			message:
				"An expected-hours override only applies to hourly students and contractors",
			path: ["expectedSecondsOverride"],
		},
	);
export type SetMemberTypeInput = z.infer<typeof setMemberTypeInput>;

/** A member's user id on its own — for the read endpoints that take nothing
 *  else. Not a uuid: better-auth mints its own user id format. */
export const memberUserIdInput = z.string().min(1);
export type MemberUserIdInput = z.infer<typeof memberUserIdInput>;

export const setMemberStartDateInput = z.object({
	userId: z.string().min(1),
	startDate: dayKeySchema.nullable(),
});
export type SetMemberStartDateInput = z.infer<typeof setMemberStartDateInput>;

/** Archive or restore a person (PRD 3.1). Never a delete — history has to
 *  survive them leaving. */
export const setMemberArchivedInput = z.object({
	userId: z.string().min(1),
	archived: z.boolean(),
});
export type SetMemberArchivedInput = z.infer<typeof setMemberArchivedInput>;

// The REST route's role change. It names the person by user id, as every
// other People route does; the service finds the membership row.
export const setMemberRoleInput = z.object({
	userId: z.string().min(1),
	role: z.enum(["admin", "member"]),
});
export type SetMemberRoleInput = z.infer<typeof setMemberRoleInput>;
