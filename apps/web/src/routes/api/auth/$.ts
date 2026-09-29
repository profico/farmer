import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { z } from "zod";

/** better-auth's device authorization endpoints: `/device` (verify), and
 *  `/device/code`, `/device/token`, `/device/approve`, `/device/deny`. */
const DEVICE_PATH = /^\/api\/auth\/device(?:\/|$)/;

/** The two impersonation endpoints, as the browser reaches them. */
const IMPERSONATE_PATH = "/api/auth/admin/impersonate-user";
const STOP_IMPERSONATING_PATH = "/api/auth/admin/stop-impersonating";

/** The one field of `impersonate-user`'s answer the ledger reads: the person
 *  the session now belongs to. Parsed rather than trusted, so a change in
 *  better-auth's answer costs a missing ledger entry instead of a 500 on a
 *  session swap that has already happened. */
const impersonateResult = z.object({
	user: z.object({ id: z.string(), name: z.string().nullish() }),
});

/**
 * The same two entries in the audit log of every workspace the impersonated
 * person is in, where an administrator of that workspace can read them. The
 * PostHog ledger answers the operators of the deployment; this one answers the
 * workspace.
 *
 * `recordSecurityEvent` never throws, and the import is caught as well, for
 * the reason the ledger gives: the session has already changed.
 */
const recordImpersonation = async (
	kind: "impersonation.started" | "impersonation.stopped",
	entry: {
		operatorId: string;
		impersonatedUserId: string;
		impersonatedName: string | null;
	},
	request: Request,
): Promise<void> => {
	try {
		const [{ recordSecurityEvent }, { requestActor }] = await Promise.all([
			import("@farmer/core/services"),
			import("#/server/api-auth.ts"),
		]);
		const { ip, userAgent } = requestActor(request, { via: "web" });
		await recordSecurityEvent({
			kind,
			subjectUserId: entry.impersonatedUserId,
			actorUserId: entry.operatorId,
			actor: { via: "web", ip, userAgent },
			target: {
				type: "member",
				id: entry.impersonatedUserId,
				label: entry.impersonatedName,
			},
		});
	} catch (error) {
		console.error("[audit] could not record an impersonation", error);
	}
};

/**
 * The ledger's two entries, written where nothing can decline to write them.
 *
 * Both ids come from the server's own state — the session behind the request,
 * and better-auth's own answer — never from what the browser said it was doing.
 * `lib/posthog-impersonation.ts` explains why the entries are captured on the
 * operator's profile rather than the impersonated person's, and
 * `routes/__root.tsx` tags the activity BETWEEN the two entries.
 *
 * Nothing here can fail the request. The session has already changed by the
 * time any of it runs, so an error raised now would strand an operator midway
 * between two identities; a lost ledger entry is the smaller harm, and the
 * adapter logs it.
 */
const writeLedgerEntry = async (
	pathname: string,
	before: {
		user: { id: string; name: string };
		session: { impersonatedBy?: string | null };
	},
	response: Response,
	request: Request,
): Promise<void> => {
	const ledger = await import("#/lib/posthog-impersonation.ts");

	if (pathname === STOP_IMPERSONATING_PATH) {
		// Read BEFORE the handler answered, because on Stop this session is the
		// impersonated one and the endpoint deletes it.
		const operatorId = before.session.impersonatedBy;
		if (!operatorId) return;
		await ledger.captureImpersonationStopped({
			operatorId,
			impersonatedUserId: before.user.id,
		});
		await recordImpersonation(
			"impersonation.stopped",
			{
				operatorId,
				impersonatedUserId: before.user.id,
				impersonatedName: before.user.name,
			},
			request,
		);
		return;
	}

	const body = await response
		.clone()
		.json()
		.catch(() => null);
	const parsed = impersonateResult.safeParse(body);
	if (!parsed.success) return;
	await ledger.captureImpersonationStarted({
		operatorId: before.user.id,
		impersonatedUserId: parsed.data.user.id,
	});
	await recordImpersonation(
		"impersonation.started",
		{
			operatorId: before.user.id,
			impersonatedUserId: parsed.data.user.id,
			impersonatedName: parsed.data.user.name ?? null,
		},
		request,
	);
};

/**
 * Every better-auth endpoint, with one exception decided here.
 *
 * The device flow is the CLI's sign-in and nothing else's, so `CLI_ENABLED=false`
 * takes it away: a 404, the same answer `/api/v1/orgs/*` gives, rather than a
 * flow that hands out a token the API then refuses. The plugin stays mounted
 * either way (see `packages/core/src/auth/index.ts`), which keeps the schema
 * and the flag independent — flipping the variable needs no migration.
 *
 * The two impersonation paths are read as well as served. This is the only
 * mount of `auth.handler`, so it is the one place every impersonation must pass
 * through, whoever called it and from wherever.
 */
const handle = async (request: Request) => {
	const { pathname } = new URL(request.url);
	if (DEVICE_PATH.test(pathname)) {
		const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");
		if (!isCliEnabled()) {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
	}
	const { auth } = await import("@farmer/core/auth");

	const impersonation =
		pathname === IMPERSONATE_PATH || pathname === STOP_IMPERSONATING_PATH;
	const before = impersonation
		? await auth.api.getSession({ headers: request.headers })
		: null;

	const response = await auth.handler(request);

	// A refusal is not an entry. Both endpoints answer 4xx without touching a
	// session, and a ledger that records attempts as events would read as
	// impersonations that never happened.
	if (before && response.ok) {
		await writeLedgerEntry(pathname, before, response, request);
	}
	return response;
};

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => handle(request),
			POST: ({ request }) => handle(request),
		},
	},
});
