import { queryOptions } from "@tanstack/react-query";

import { listTeamLeadPeople } from "#/server/team-leads.ts";

import { queryKeys } from "./keys.ts";

// Under the members family: the list is part of the roster, and every write
// on the Members page already invalidates that root.
export const teamLeadPeopleQuery = (org: string, leadUserId: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).members, "team-lead", leadUserId],
		queryFn: () => listTeamLeadPeople({ data: leadUserId }),
	});
