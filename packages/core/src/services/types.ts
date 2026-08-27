import type { Access } from "./access.service";

/** Per-request memo, reached only through the helpers in `./context`.
 *
 *  Keyed by a symbol so it stays out of the way of object literals, spreads
 *  and anything that enumerates a Ctx's keys. */
export const CTX_MEMO = Symbol.for("farmer.ctx.memo");

export type CtxMemo = {
	timezone?: Promise<string>;
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
 *  `{ organizationId, userId }` literal is still a valid Ctx. */
export type Ctx = {
	organizationId: string;
	userId: string;
	[CTX_MEMO]?: CtxMemo;
};
