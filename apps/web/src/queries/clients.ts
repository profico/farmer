import { queryOptions } from "@tanstack/react-query";
import { listClients } from "#/server/clients.ts";

export const clientsQuery = () =>
	queryOptions({
		queryKey: ["clients"],
		queryFn: () => listClients(),
	});
