import { createServerFn } from "@tanstack/react-start";
import { orgMiddleware } from "./auth";

export const listClients = createServerFn({ method: "GET" })
	.middleware([orgMiddleware])
	.handler(async ({ context }) => {
		const { clientsService } = await import("@farmer/core/services");
		return clientsService.list(context.ctx);
	});
