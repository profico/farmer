import { createServerFn } from "@tanstack/react-start";

import { sessionMiddleware } from "./auth";
import type { DeploymentInfo } from "./deployment-info";

/**
 * Who built this and what commit it is running — the contributors card at the
 * foot of Settings.
 *
 * `sessionMiddleware` rather than nothing: the card is for the people who use
 * this deployment, and an open read would let anybody spend the server's
 * anonymous GitHub budget (`lib/github-public.ts`). It is not
 * org-scoped either — the answer is about the BUILD, and it is the same in
 * every workspace — so there is no `Ctx` to resolve and no org to name.
 *
 * The GitHub read behind it is deferred (`server/deployment-info.ts`), which is
 * the client-bundle rule: that module is server-only.
 */
export const getDeploymentInfo = createServerFn({ method: "GET" })
	.middleware([sessionMiddleware])
	.handler(async (): Promise<DeploymentInfo> => {
		const { readDeploymentInfo } = await import("./deployment-info");
		return readDeploymentInfo();
	});
