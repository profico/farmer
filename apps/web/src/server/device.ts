import { MOBILE_CLIENT_ID } from "@farmer/core/api";
import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { sessionMiddleware } from "./auth";

/** Which client started a device code. `/device` words its page from it. */
export type DeviceClient = "cli" | "mobile";

/**
 * The client that started a device code, so `/device` can say what asks for
 * the sign-in. better-auth's own read of a code does not return it.
 *
 * Only a signed-in person may ask, and the answer binds nothing: opening the
 * code is still the call that claims it. A code that does not exist, or an
 * old one with no client, reads as the CLI, which is the original client.
 */
export const getDeviceClient = createServerFn({ method: "GET" })
	.middleware([sessionMiddleware])
	.validator(z.object({ userCode: z.string().min(1).max(32) }))
	.handler(async ({ data }): Promise<DeviceClient> => {
		const [{ db }, { deviceCode }] = await Promise.all([
			import("@farmer/core/db"),
			import("@farmer/core/schema/auth"),
		]);
		const row = await db.query.deviceCode.findFirst({
			columns: { clientId: true },
			where: eq(deviceCode.userCode, data.userCode),
		});
		return row?.clientId === MOBILE_CLIENT_ID ? "mobile" : "cli";
	});
