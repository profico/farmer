import { queryOptions } from "@tanstack/react-query";
import { getSignInMethods } from "#/server/account.ts";
import { queryKeys } from "./keys.ts";

export const signInMethodsQuery = () =>
	queryOptions({
		queryKey: [...queryKeys.account, "sign-in-methods"],
		queryFn: () => getSignInMethods(),
	});
