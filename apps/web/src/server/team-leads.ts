import {
	setTeamLeadPeopleInput,
	teamLeadUserIdInput,
} from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgAdminMiddleware, orgMiddleware } from "./auth";

// A Team Lead's people list. Reading is the lead's own or an admin's (the
// service decides); writing is an admin's — the list is what grants the lead
// their visibility, so it is edited where people are managed, not by the lead.
export const listTeamLeadPeople = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(teamLeadUserIdInput)
	.handler(async ({ data: leadUserId, context }) => {
		const { teamLeadsService } = await import("@farmer/core/services");

		return teamLeadsService.listPeople(context.ctx, leadUserId);
	});

export const setTeamLeadPeople = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(setTeamLeadPeopleInput)
	.handler(async ({ data, context }) => {
		const { teamLeadsService } = await import("@farmer/core/services");

		return teamLeadsService.setPeople(context.ctx, data);
	});
