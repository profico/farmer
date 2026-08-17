import { queryOptions } from "@tanstack/react-query";
import { listAllClients, listClients } from "#/server/clients.ts";
import { queryKeys } from "./keys.ts";

export const clientsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).clients],
		queryFn: () => listClients(),
	});

/** Archived included — only the management screen wants these. */
export const allClientsQuery = (org: string) =>
	queryOptions({
		queryKey: [...queryKeys(org).clients, "all"],
		queryFn: () => listAllClients(),
	});
