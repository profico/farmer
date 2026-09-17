// The request-scoped facts every service kept re-deriving: the organization's
// timezone, the caller's authorization picture, and the db handle to run on.
//
// Before this module, `orgTimezone(ctx.organizationId)` ran at 19 call sites and
// `accessService.resolve` at 66 — each an uncached round trip, several of them
// inside the same request. One `setWeekCell` that cleared three duplicates
// issued five identical organization lookups. The Access class's own docblock
// already asked callers to "resolve this ONCE per request and pass it down";
// nothing enforced it, because there was nowhere to put the answer.
//
// The answer goes on the Ctx. Resolution stays lazy — a request that never asks
// for the timezone still never queries for it — and the memo holds the promise
// rather than the value, so two concurrent callers inside one `Promise.all`
// share a single query instead of racing to issue two.

import { db } from "../db";
import { orgTimezone, orgWeekStartsOn } from "../lib/org-time";
import type { WeekStartsOn } from "../lib/time";
import { type Access, accessService } from "./access.service";
import { ctxDb, type DbClient } from "./db-ctx";
import { CTX_MEMO, type Ctx, type CtxMemo } from "./types";

// Re-exported so the many `import { ctxDb } from "./context"` call sites keep
// working; the definition lives in ./db-ctx to avoid an import cycle with the
// helpers ./context itself depends on.
export { ctxDb, type DbClient };

const memoOf = (ctx: Ctx): CtxMemo => {
	// Ctx objects arrive as plain literals from middleware, jobs and REST
	// routes, so the slot is created on first use rather than at construction.
	let memo = ctx[CTX_MEMO];

	if (!memo) {
		memo = {};
		Object.defineProperty(ctx, CTX_MEMO, {
			value: memo,
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}

	return memo;
};

/** The organization's IANA timezone, resolved once per Ctx. Defaults to UTC.
 *
 *  Runs on `ctxDb(ctx)`, not the ambient handle — and it has to delegate to
 *  `lib/org-time`'s `orgTimezone` WITH that handle rather than letting it fall
 *  back to its own default, so there stays one definition of the query.
 *
 *  Three callers ask for the timezone from INSIDE `withCtxTx`
 *  (`time-entries.service`: remove, setWeekCell, copyDay). `withCtxTx` copies
 *  the parent's memo into the transaction's Ctx, so a warm memo resolves from
 *  memory and nothing queries. A COLD one does not: the lookup then runs on the
 *  ambient handle, from inside an open transaction — reading pre-transaction
 *  state on a pool, and deadlocking outright on a single-connection handle
 *  (PGLite, which is what the tests run on), because the transaction is waiting
 *  on a query queued behind it.
 *
 *  That is not a test-only failure. It needs a Ctx whose timezone has not been
 *  touched yet — which is exactly what a fresh Ctx built per call looks like,
 *  and the assistant's tools build one per turn. */
export const ctxTimezone = (ctx: Ctx): Promise<string> => {
	const memo = memoOf(ctx);
	memo.timezone ??= orgTimezone(ctx.organizationId, ctxDb(ctx));

	return memo.timezone;
};

/** The day the organization's weeks start on, resolved once per Ctx, on
 *  `ctxDb(ctx)` for the same reason as the timezone above. */
export const ctxWeekStartsOn = (ctx: Ctx): Promise<WeekStartsOn> => {
	const memo = memoOf(ctx);
	memo.weekStartsOn ??= orgWeekStartsOn(ctx.organizationId, ctxDb(ctx));

	return memo.weekStartsOn;
};

/** The caller's authorization picture, resolved once per Ctx. Resolved through
 *  `ctxDb` for the same reason as the timezone above. */
export const ctxAccess = (ctx: Ctx): Promise<Access> => {
	const memo = memoOf(ctx);
	memo.access ??= accessService.resolve(ctx);

	return memo.access;
};

/** `ctxAccess` plus the admin assertion — the shape most admin-only service
 *  functions open with. */
export const requireAdmin = async (ctx: Ctx): Promise<Access> => {
	const access = await ctxAccess(ctx);
	access.assertAdmin();

	return access;
};

/** The raw memo slot, for a service that owns a per-Ctx cache of its own
 *  (today: `holidays.service`). Everything else should go through one of the
 *  named helpers above rather than reaching in here. */
export const ctxMemo = (ctx: Ctx): CtxMemo => memoOf(ctx);

/** Drop the memoized authorization picture.
 *
 *  Call after a service changes the caller's own project assignments or org
 *  role in the same request — the memo would otherwise answer from the picture
 *  as it was before the write. Timezone is not invalidated here; org settings
 *  writes go through `organization.service`, which does it itself. */
export const invalidateCtxAccess = (ctx: Ctx): void => {
	const memo = ctx[CTX_MEMO];

	if (memo) memo.access = undefined;
};

/** Drop the memoized timezone and week start, after an org settings write
 *  changed either. */
export const invalidateCtxOrgCalendar = (ctx: Ctx): void => {
	const memo = ctx[CTX_MEMO];

	if (!memo) return;
	memo.timezone = undefined;
	memo.weekStartsOn = undefined;
};

/** Run `fn` in a transaction, giving it a Ctx bound to that transaction.
 *
 *  Everything the callback calls with the child Ctx runs inside the
 *  transaction, including helpers several layers down that only ever see a Ctx.
 *  The memoized timezone and access carry over — they were resolved for this
 *  request and are not affected by the transaction. */
export const withCtxTx = async <T>(
	ctx: Ctx,
	fn: (txCtx: Ctx) => Promise<T>,
): Promise<T> => {
	// Already inside one: reuse it rather than opening a nested transaction.
	if (ctx[CTX_MEMO]?.tx) return fn(ctx);

	return db.transaction(async (tx) => {
		const parent = memoOf(ctx);

		const txCtx: Ctx = {
			organizationId: ctx.organizationId,
			userId: ctx.userId,
		};

		Object.defineProperty(txCtx, CTX_MEMO, {
			value: {
				timezone: parent.timezone,
				weekStartsOn: parent.weekStartsOn,
				access: parent.access,
				tx,
			} satisfies CtxMemo,
			enumerable: false,
			writable: true,
			configurable: true,
		});

		return fn(txCtx);
	});
};
