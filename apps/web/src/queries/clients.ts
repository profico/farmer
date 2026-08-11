import { queryOptions } from "@tanstack/react-query";
import { listAllClients, listClients } from "#/server/clients.ts";

export const clientsQuery = () =>
	queryOptions({
		queryKey: ["clients"],
		queryFn: () => listClients(),
	});

/** Archived included — only the management screen wants these. */
export const allClientsQuery = () =>
	queryOptions({
		queryKey: ["clients", "all"],
		queryFn: () => listAllClients(),
	});
