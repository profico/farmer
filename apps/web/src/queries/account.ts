import { queryOptions } from "@tanstack/react-query";
import { getSignInMethods } from "#/server/account.ts";

export const signInMethodsQuery = () =>
	queryOptions({
		queryKey: ["account", "sign-in-methods"],
		queryFn: () => getSignInMethods(),
	});
