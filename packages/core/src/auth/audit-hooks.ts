// What the better-auth hooks in `./index.ts` need to write audit rows
// (issue #112, `docs/domains/audit-log.md`). This file must not import from
// `./index.ts`: the hooks are wired there, and the import would be a cycle.

import { getCurrentAuthContext } from "@better-auth/core/context";
import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db";
import { auditEvent } from "../db/schema/audit";
import * as schema from "../db/schema/auth";
import type { AuditVia } from "../lib/audit";
import { clientAddress, trustedIpHeader } from "../lib/client-address";
import { recordSecurityEvent } from "../services/audit";
import type { Ctx, CtxActor } from "../services/types";

// ── The audit log ───────────────────────────────────────────────────────────
//
// Member management and sign-in go through better-auth, not through a service,
// so its hooks in `./index.ts` are where they reach the audit log (issue #112),
// through the helpers here. Every hook runs after better-auth has decided, so
// none of them may throw into it:
// `recordAudit` and `recordSecurityEvent` never throw, and every lookup of our
// own is caught.

/**
 * The client's address, by the rule the web app's rate limits use
 * (`lib/client-address.ts`): the one header `TRUSTED_IP_HEADER` names, else
 * the socket address the production host recorded. Never better-auth's own
 * `session.ipAddress`, which trusts the first `x-forwarded-for` entry, the one
 * a caller writes. The shared rule answers `"unknown"` for no address. A row
 * stores null for that.
 */
const addressOf = (headers: Headers): string | null => {
	const address = clientAddress(
		headers,
		trustedIpHeader(process.env.TRUSTED_IP_HEADER),
	);
	return address === "unknown" ? null : address;
};

type RequestOrigin = { ip: string | null; userAgent: string | null };

export const originOf = (headers: Headers | null | undefined): RequestOrigin =>
	headers
		? { ip: addressOf(headers), userAgent: headers.get("user-agent") }
		: { ip: null, userAgent: null };

/** `impersonatedBy` on a session, which better-auth types as `any`. */
export const impersonatorOf = z.string().min(1).nullable().catch(null);

/** Who called the better-auth endpoint that is running now. */
type Caller = RequestOrigin & {
	userId: string | null;
	impersonatorId: string | null;
};

/**
 * The caller of the endpoint this hook runs inside, or null outside one.
 *
 * The organization hooks name the member acted ON, and only some of them name
 * the person acting. better-auth keeps the endpoint's context in an
 * AsyncLocalStorage for the whole call, and its `session` is the caller's once
 * the endpoint's session middleware has run, which is before any of these
 * hooks. `getCurrentAuthContext` throws outside an endpoint (a script that
 * writes a row by hand), which is a caller nobody can name.
 */
export const currentCaller = async (): Promise<Caller | null> => {
	try {
		const endpoint = await getCurrentAuthContext();
		const session = endpoint.context.session;
		return {
			userId: session?.user.id ?? null,
			impersonatorId: impersonatorOf.parse(session?.session.impersonatedBy),
			...originOf(endpoint.headers ?? endpoint.request?.headers),
		};
	} catch {
		return null;
	}
};

export const callerActor = (
	caller: Caller | null,
	via: AuditVia,
): CtxActor => ({
	via,
	impersonatorId: caller?.impersonatorId ?? null,
	ip: caller?.ip ?? null,
	userAgent: caller?.userAgent ?? null,
});

/** The Ctx an organization hook records with. `fallbackUserId` names the
 *  actor when no session does: accepting an invitation is done by the person
 *  who joins. */
export const hookCtx = (
	organizationId: string,
	caller: Caller | null,
	fallbackUserId: string | null,
): Ctx => ({
	organizationId,
	userId: caller?.userId ?? fallbackUserId ?? "",
	actor: callerActor(caller, "web"),
});

/** Account rows that are integrations rather than ways to sign in. They
 *  enrich time entries (see `account.service.ts`), so linking one is not a
 *  change to how somebody gets in. */
export const INTEGRATION_PROVIDERS = new Set(["github", "google-calendar"]);

export const signInMethodLabel = (providerId: string): string =>
	providerId === "credential" ? "password" : providerId;

/**
 * The provider a callback endpoint ran for, from its route params, which
 * better-auth types as `any`. A social callback names it `id`, the genericOAuth
 * plugin's callback names it `providerId`.
 */
export const callbackProvider = z
	.object({
		id: z.string().min(1).optional(),
		providerId: z.string().min(1).optional(),
	})
	.transform(({ id, providerId }) => id ?? providerId ?? null)
	.catch(null);

/**
 * How a session was made, from the endpoint that made it.
 *
 * `path` is the endpoint's DECLARED path, not the URL the browser asked for, so
 * an OAuth callback arrives as the literal `/callback/:id` (and the genericOAuth
 * plugin's as `/oauth2/callback/:providerId`). Reading the provider out of
 * `path` therefore recorded the string `":id"` as the method of every social
 * sign-in. It is a route param, so the caller passes it as `provider` —
 * `callbackProvider.parse(context?.params)`, the rule better-auth's own
 * last-login-method plugin follows.
 */
export const signInMethod = (
	path: string | undefined,
	provider: string | null,
): string | null => {
	if (!path) return null;
	if (path === "/sign-in/email" || path === "/sign-up/email") return "password";
	if (path.startsWith("/device")) return "device";
	return path.includes("/callback/") ? provider : null;
};

export const signInBody = z.object({ email: z.string().min(1) });

/** One person gets at most one failed sign-in row in this window. */
export const FAILED_SIGN_IN_WINDOW_MS = 60_000;

/**
 * `auth.sign_in_failed`, for a password that did not sign anybody in.
 *
 * Only for an address that has an account. A row for an unknown address would
 * let anybody on the internet write to a workspace's log, and would say which
 * addresses have no account; neither is worth the row.
 *
 * At most one row per person in each `FAILED_SIGN_IN_WINDOW_MS`. The row goes
 * to every workspace of the person, and a caller controls the address, so
 * without this limit one caller could fill many logs with many attempts. The
 * window keys on the person, not on the address, for that reason.
 */
export const recordFailedSignIn = async (
	email: string,
	headers: Headers | undefined,
	reason: string | null,
): Promise<void> => {
	try {
		const person = await db.query.user.findFirst({
			where: sql`lower(${schema.user.email}) = lower(${email})`,
			columns: { id: true },
		});
		if (!person) return;
		const recent = await db.query.auditEvent.findFirst({
			where: and(
				eq(auditEvent.kind, "auth.sign_in_failed"),
				eq(auditEvent.subjectUserId, person.id),
				gte(
					auditEvent.occurredAt,
					new Date(Date.now() - FAILED_SIGN_IN_WINDOW_MS),
				),
			),
			columns: { id: true },
		});
		if (recent) return;
		await recordSecurityEvent({
			kind: "auth.sign_in_failed",
			subjectUserId: person.id,
			actorUserId: null,
			actor: { via: "web", ...originOf(headers) },
			details: { method: "password", reason },
		});
	} catch (error) {
		console.error("[audit] could not record a failed sign-in", error);
	}
};
