import {
	PLATFORM_ADMIN_ROLE,
	PLATFORM_USER_ROLE,
} from "@farmer/core/lib/platform-admin";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

import { platformAdminMiddleware } from "./auth";

/**
 * The Infrastructure page's reads and its one write.
 *
 * Gated on `platformAdminMiddleware` throughout — `user.role`, not a workspace
 * role. These are instance-level, so nothing here takes or returns an
 * organization, and the queries behind them carry no tenancy predicate. That is
 * the one place in this app where that is correct; see
 * `packages/core/src/services/platform-admins.service.ts`.
 */

export const listPlatformAdmins = createServerFn({ method: "GET" })
	.middleware([platformAdminMiddleware])
	.handler(async () => {
		const { platformAdminsService } = await import("@farmer/core/services");
		return platformAdminsService.list();
	});

export const searchPlatformPeople = createServerFn({ method: "GET" })
	.middleware([platformAdminMiddleware])
	.validator(z.string())
	.handler(async ({ data }) => {
		const { platformAdminsService } = await import("@farmer/core/services");
		return platformAdminsService.search(data);
	});

/**
 * Anonymise one person's account, the answer to a request to delete it.
 *
 * Platform admins only. `anonymiseService` holds the refusals (yourself, the
 * last platform admin, the only active owner of a workspace); this layer
 * adds nothing but the gate and the caller's id. The admin types the address
 * in the dialog, and the server checks it again, so a stale tab cannot
 * anonymise a different person than the one on the screen.
 */
export const anonymiseAccount = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(z.object({ userId: z.string().min(1), email: z.string() }))
	.handler(async ({ data, context }) => {
		const { anonymiseService, platformAdminsService } =
			await import("@farmer/core/services");
		const person = await platformAdminsService.find(data.userId);
		if (!person) throw new Error("That account no longer exists.");
		if (person.email.toLowerCase() !== data.email.trim().toLowerCase()) {
			throw new Error("The address does not match this account.");
		}
		await anonymiseService.anonymise(
			{ userId: context.session.user.id, actor: { via: "web" } },
			person.id,
		);
		return { ok: true as const };
	});

const setPlatformAdminInput = z.object({
	userId: z.string().min(1),
	/** True promotes, false demotes. One function rather than two, because the
	 *  guards below are the same guards in both directions. */
	isPlatformAdmin: z.boolean(),
});

/**
 * Promote or demote somebody.
 *
 * **Routed through better-auth's `admin/set-role`, not an UPDATE.** The plugin
 * owns the `role` column (`input: false`) and checks the caller's permission
 * before it writes. A second writer would split the rule about who may write.
 * The middleware above and the plugin check both stay in the path: one keeps
 * the screen from a reader, the other refuses the write from any caller.
 *
 * Two refusals are this deployment's rules, not better-auth's:
 *
 * - **Nobody demotes themselves.** Only another admin can undo it.
 * - **Never leave the instance with no platform admin.** Only the first
 *   account gets the role by bootstrap, so zero admins has no way back except
 *   SQL. No caller reaches this today, because the caller is an admin and
 *   self-demotion is refused. Keep it as an invariant for a future caller
 *   behind a different gate.
 */
export const setPlatformAdmin = createServerFn({ method: "POST" })
	.middleware([platformAdminMiddleware])
	.validator(setPlatformAdminInput)
	.handler(async ({ data, context }) => {
		const { platformAdminsService } = await import("@farmer/core/services");
		const person = await platformAdminsService.find(data.userId);
		if (!person) throw new Error("That account no longer exists.");
		if (person.isPlatformAdmin === data.isPlatformAdmin) return person;

		if (!data.isPlatformAdmin) {
			if (person.id === context.session.user.id) {
				throw new Error(
					"You cannot remove your own platform admin role. Ask another platform admin to do it.",
				);
			}
			if ((await platformAdminsService.count()) <= 1) {
				throw new Error(
					"This is the only platform admin. Give somebody else the role first.",
				);
			}
		}

		const { auth } = await import("@farmer/core/auth");
		await auth.api.setRole({
			body: {
				userId: person.id,
				role: data.isPlatformAdmin ? PLATFORM_ADMIN_ROLE : PLATFORM_USER_ROLE,
			},
			headers: getRequestHeaders(),
		});
		return { ...person, isPlatformAdmin: data.isPlatformAdmin };
	});
