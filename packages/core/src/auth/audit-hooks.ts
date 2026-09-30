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
import { recordAudit, recordSecurityEvent } from "../services/audit";
import type { Ctx, CtxActor } from "../services/types";

// ── The audit log ───────────────────────────────────────────────────────────
//
// Member management and sign-in go through better-auth, not through a service,
// so its hooks in `./index.ts` are where they reach the audit log (issue #112),
// through the helpers here. Every hook runs after better-auth has decided, so
// none of them may throw into it:
// `recordAudit` and `recordSecurityEvent` never throw, and every lookup of our
// own is caught.

/** The internal header the production host writes the socket address into
 *  (`SOCKET_ADDRESS_HEADER` in `apps/web/src/lib/client-address.ts`). */
const SOCKET_ADDRESS_HEADER = "x-farmer-socket-address";

/**
 * The client's address, by the rule the web app's rate limits use
 * (`apps/web/src/lib/client-address.ts`, which this package cannot import):
 * the one header `TRUSTED_IP_HEADER` names (default `cf-connecting-ip`; the
 * LAST `x-forwarded-for` entry), else the socket address the production host
 * recorded. Never better-auth's own `session.ipAddress`, which trusts the
 * first `x-forwarded-for` entry, the one a caller writes.
 */
const clientAddress = (headers: Headers): string | null => {
	const configured = (process.env.TRUSTED_IP_HEADER ?? "cf-connecting-ip")
		.trim()
		.toLowerCase();
	if (configured !== "" && configured !== "none") {
		const value = headers.get(configured);
		const address =
			configured === "x-forwarded-for"
				? value?.split(",").at(-1)?.trim()
				: value?.trim();
		if (address) return address;
	}
	return headers.get(SOCKET_ADDRESS_HEADER)?.trim() || null;
};

type RequestOrigin = { ip: string | null; userAgent: string | null };

export const originOf = (headers: Headers | null | undefined): RequestOrigin =>
	headers
		? { ip: clientAddress(headers), userAgent: headers.get("user-agent") }
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

/** `member.joined`, for both ways in: an invitation accepted, or an admin
 *  (or the creation of an organization) adding the person directly. */
export const recordJoined = async (
	joined: { id: string; organizationId: string; userId: string; role: string },
	name: string,
): Promise<void> => {
	const caller = await currentCaller();
	await recordAudit(hookCtx(joined.organizationId, caller, joined.userId), {
		kind: "member.joined",
		subjectUserId: joined.userId,
		target: { type: "member", id: joined.userId, label: name },
		details: { role: joined.role },
	});
};

/** Account rows that are integrations rather than ways to sign in. They
 *  enrich time entries (see `account.service.ts`), so linking one is not a
 *  change to how somebody gets in. */
export const INTEGRATION_PROVIDERS = new Set(["github", "google-calendar"]);

export const signInMethodLabel = (providerId: string): string =>
	providerId === "credential" ? "password" : providerId;

/** How a session was made, from the path of the endpoint that made it. */
export const signInMethod = (path: string | undefined): string | null => {
	if (!path) return null;
	if (path === "/sign-in/email" || path === "/sign-up/email") return "password";
	if (path.startsWith("/device")) return "device";
	return /\/callback\/([^/]+)$/.exec(path)?.[1] ?? null;
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
