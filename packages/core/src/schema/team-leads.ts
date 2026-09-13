import { z } from "zod";

// A Team Lead's people list, replaced wholesale: the Members page hands back
// the whole list, so there is no add/remove pair to keep in step.
export const setTeamLeadPeopleInput = z.object({
	leadUserId: z.string().min(1),
	personUserIds: z.array(z.string().min(1)).max(500),
});
export type SetTeamLeadPeopleInput = z.infer<typeof setTeamLeadPeopleInput>;

export const teamLeadUserIdInput = z.string().min(1);
