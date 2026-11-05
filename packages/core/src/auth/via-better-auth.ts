import { isAPIError } from "better-auth/api";

import { UserFacingError } from "../lib/user-facing-error";
import { AccessError } from "../services/access.service";

/** Runs a better-auth call, and turns its refusal into an error that the
 *  REST API may show: 403 for a refusal of access, 422 for the rest. Its
 *  messages are fixed sentences such as "User is already a member of this
 *  organization". */
export const viaBetterAuth = async <T>(call: () => Promise<T>): Promise<T> => {
	try {
		return await call();
	} catch (error) {
		if (isAPIError(error)) {
			if (error.statusCode === 401 || error.statusCode === 403) {
				throw new AccessError(error.message);
			}
			throw new UserFacingError(error.message);
		}
		throw error;
	}
};
