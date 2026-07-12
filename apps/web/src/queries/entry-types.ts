import { queryOptions } from "@tanstack/react-query";
import {
	listAvailableEntryTypes,
	listManagedEntryTypes,
} from "#/server/entry-types.ts";

export const availableEntryTypesQuery = () =>
	queryOptions({
		queryKey: ["entry-types", "available"],
		queryFn: () => listAvailableEntryTypes(),
	});

export const managedEntryTypesQuery = () =>
	queryOptions({
		queryKey: ["entry-types", "managed"],
		queryFn: () => listManagedEntryTypes(),
	});
