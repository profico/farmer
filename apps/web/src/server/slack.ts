import { sendTestSlackMessageInput } from "@farmer/core/schema";
import { createServerFn } from "@tanstack/react-start";
import { orgAdminMiddleware } from "./auth";

// The bot token never crosses the wire in either direction. It is minted inside
// the OAuth callback route and written straight to the database; nothing here
// returns it — `slackService.status` selects around it — so a compromised client
// session can't exfiltrate the workspace credential.

export const getSlackStatus = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { slackService } = await import("@farmer/core/services");
		return slackService.status(context.ctx);
	});

export const getSlackInstallUrl = createServerFn({ method: "GET" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { slackService } = await import("@farmer/core/services");
		return slackService.installUrl(context.ctx);
	});

export const disconnectSlack = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { slackService } = await import("@farmer/core/services");
		return slackService.disconnect(context.ctx);
	});

export const syncSlackIdentities = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.handler(async ({ context }) => {
		const { slackService } = await import("@farmer/core/services");
		return slackService.syncIdentities(context.ctx);
	});

export const sendTestSlackMessage = createServerFn({ method: "POST" })
	.middleware([orgAdminMiddleware])
	.validator(sendTestSlackMessageInput)
	.handler(async ({ data, context }) => {
		const { slackService } = await import("@farmer/core/services");
		return slackService.sendTest(context.ctx, data.userId);
	});
