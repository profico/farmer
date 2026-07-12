import { z } from "zod";

export const inviteMemberInput = z.object({
	email: z.email(),
	role: z.enum(["admin", "member"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

export const cancelInvitationInput = z.uuid();
export type CancelInvitationInput = z.infer<typeof cancelInvitationInput>;

// better-auth's removeMember accepts either the member row id or the
// member's email — can't narrow further than "non-empty string".
export const removeMemberInput = z.string().min(1);
export type RemoveMemberInput = z.infer<typeof removeMemberInput>;

export const updateMemberRoleInput = z.object({
	memberId: z.uuid(),
	role: z.enum(["admin", "member"]),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInput>;
