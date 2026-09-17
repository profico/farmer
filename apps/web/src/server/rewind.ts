import { rewindInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";

import { orgMiddleware } from "./auth";

// The caller's own year in review. Nothing to scope: the service reads only
// `ctx.userId`'s time, and `orgMiddleware` has already checked the membership.
export const getMyRewind = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.validator(rewindInput)
	.handler(async ({ data, context }) => {
		const [{ rewindService }, { isDevAuthEnabled }] = await Promise.all([
			import("@farmer/core/services"),
			import("@farmer/core/lib/dev-auth"),
		]);

		// `asOf` pins the clock so December can be looked at in September. The
		// same gate as password sign-in: in production the clock is the clock.
		const now =
			data.asOf && isDevAuthEnabled()
				? new Date(`${data.asOf}T12:00:00Z`)
				: undefined;

		return rewindService.mine(context.ctx, { year: data.year }, { now });
	});
