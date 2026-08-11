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
import { orgTimezone } from "../lib/org-time";
import { type Access, accessService } from "./access.service";
import { CTX_MEMO, type Ctx, type CtxMemo } from "./types";

export type DbClient =
	| typeof db
	| Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/** The organization's IANA timezone, resolved once per Ctx. Defaults to UTC. */
export const ctxTimezone = (ctx: Ctx): Promise<string> => {
	const memo = memoOf(ctx);
	memo.timezone ??= orgTimezone(ctx.organizationId);
	return memo.timezone;
};

/** The caller's authorization picture, resolved once per Ctx. */
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

/** Drop the memoized timezone, after an org settings write changed it. */
export const invalidateCtxTimezone = (ctx: Ctx): void => {
	const memo = ctx[CTX_MEMO];
	if (memo) memo.timezone = undefined;
};

/** The handle this Ctx should read and write through: the in-flight transaction
 *  when inside `withCtxTx`, otherwise the ambient pool.
 *
 *  This is what closes the leak where `remove`, `setWeekCell` and `copyDay`
 *  recomputed a day's fill block on the ambient handle AFTER their own
 *  transaction had committed, while `create` and `update` did it inside. */
export const ctxDb = (ctx: Ctx): DbClient =>
	(ctx[CTX_MEMO]?.tx as DbClient | undefined) ?? db;

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
