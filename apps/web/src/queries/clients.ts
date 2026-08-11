import { queryOptions } from "@tanstack/react-query";
import { listAllClients, listClients } from "#/server/clients.ts";
import { queryKeys } from "./keys.ts";

export const clientsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.clients],
		queryFn: () => listClients(),
	});

/** Archived included — only the management screen wants these. */
export const allClientsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.clients, "all"],
		queryFn: () => listAllClients(),
	});
