import type { AuditVia } from "../lib/audit";
import type { WeekStartsOn } from "../lib/time";
import type { Access } from "./access.service";

/** Per-request memo, reached only through the helpers in `./context`.
 *
 *  Keyed by a symbol so it stays out of the way of object literals, spreads
 *  and anything that enumerates a Ctx's keys. */
export const CTX_MEMO = Symbol.for("farmer.ctx.memo");

export type CtxMemo = {
	timezone?: Promise<string>;
	weekStartsOn?: Promise<WeekStartsOn>;
	access?: Promise<Access>;
	/** The org's holiday-calendar inputs (country + opted-out names). Owned by
	 *  `holidays.service`, which is the only thing that reads or clears it. */
	holidayCalendar?: Promise<unknown>;
	/** Set only inside `withCtxTx`. Absent means "use the ambient handle". */
	tx?: unknown;
};

/** Who is asking, and on behalf of which organization.
 *
 *  Tenancy is a parameter, never ambient — the same service function is callable
 *  from a server function, a REST route or a background job because all three
 *  can name a Ctx.
 *
 *  The optional memo slot lets the request-scoped facts (timezone, access,
 *  the in-flight transaction) resolve ONCE and be reused by everything the
 *  request calls, without changing how a Ctx is constructed: a plain
 *  `{ organizationId, userId }` literal is still a valid Ctx.
 *
 *  `actor` says which door the request came through, for the audit log. The
 *  entry points set it (`orgMiddleware`, the API and MCP resolvers, the
 *  assistant); a Ctx without one is a job or a script, and reads as `system`.
 *  A plain key rather than a memo slot, so a spread or a Ctx rebuilt for
 *  another person carries it along. */
export type Ctx = {
	organizationId: string;
	userId: string;
	actor?: CtxActor;
	[CTX_MEMO]?: CtxMemo;
};

/** Where a request came from, as the audit log records it. */
export type CtxActor = {
	via: AuditVia;
	/** The platform admin driving an impersonated session. */
	impersonatorId?: string | null;
	/** The API token a request presented, when `via` is `api_token`. */
	apiTokenId?: string | null;
	ip?: string | null;
	userAgent?: string | null;
};
