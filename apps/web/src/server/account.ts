import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

export const getSignInMethods = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { accountService } = await import("@farmer/core/services");
		return accountService.signInMethods(context.ctx);
	});

export const unlinkGoogleLogin = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { accountService } = await import("@farmer/core/services");
		await accountService.unlinkGoogle(context.ctx);
		return { ok: true };
	});
