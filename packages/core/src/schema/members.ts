import { z } from "zod";

export const inviteMemberInput = z.object({
	email: z.email(),
	role: z.enum(["admin", "member"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

// better-auth owns the invitation row and generates its id with its own
// generator, not as a UUID — the column is `text`, so anything narrower than a
// non-empty string rejects a valid id.
export const cancelInvitationInput = z.string().min(1);
export type CancelInvitationInput = z.infer<typeof cancelInvitationInput>;

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

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");

export const memberTypeEnum = z.enum(["billable", "overhead", "contractor"]);
export type MemberTypeValue = z.infer<typeof memberTypeEnum>;

// Type changes are effective-dated so past months keep reporting the type the
// person actually held then (PRD 3.1).
export const setMemberTypeInput = z
	.object({
		userId: z.string().min(1),
		type: memberTypeEnum,
		// Only meaningful for contractors: an explicit monthly expected value, in
		// seconds. Everyone else derives Expected from the org's monthly hour fund.
		expectedSecondsOverride: z
			.number()
			.int()
			.min(0)
			.max(400 * 3600)
			.nullable()
			.optional(),
		effectiveFrom: dateKey,
	})
	.refine(
		(data) =>
			data.type === "contractor" || data.expectedSecondsOverride == null,
		{
			message: "An expected-hours override only applies to contractors",
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
	startDate: dateKey.nullable(),
});
export type SetMemberStartDateInput = z.infer<typeof setMemberStartDateInput>;

/** Archive or restore a person (PRD 3.1). Never a delete — history has to
 *  survive them leaving. */
export const setMemberArchivedInput = z.object({
	userId: z.string().min(1),
	archived: z.boolean(),
});
export type SetMemberArchivedInput = z.infer<typeof setMemberArchivedInput>;
