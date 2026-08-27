import { type DbClient, db } from "../db";
import { CTX_MEMO, type Ctx } from "./types";

// `ctxDb` lives here rather than in `./context` for one reason: the helpers that
// most need it — `accessService.resolve`, the `guards.ts` asserts,
// `tasksService.findBySystemKey` — are imported BY `./context`, so importing it
// from there would close a cycle. This module imports nothing but the db handle
// and the Ctx shape, so anything may depend on it.
//
// `./context` re-exports both names, so existing `import { ctxDb } from
// "./context"` call sites are unaffected.

export type { DbClient };

/**
 * The handle this Ctx should read and write through: the in-flight transaction
 * when inside `withCtxTx`, otherwise the ambient pool.
 *
 * Reaching for the ambient `db` instead is not merely a style slip, it is a
 * deadlock. `db.transaction` reserves a connection for the whole transaction,
 * so a helper that reads the ambient pool from inside one needs a SECOND
 * connection while holding the first. The pool is 10 wide by default with no
 * `connect_timeout`, so ten concurrent requests doing that hold all ten
 * connections and all ten wait forever for an eleventh.
 *
 * That is not theoretical: `remove`, `copyDay` and `setWeekCell` all called
 * `ctxTimezone` from inside their own transaction, and `ctxTimezone` resolved
 * through the ambient handle. It went unnoticed because the memo is usually
 * warm by then — and in tests, because every test file shares one Ctx object
 * that an earlier call already populated. Against a fresh Ctx (which is exactly
 * what `requireOrgContext` hands every request) it deadlocked on the first try.
 */
export const ctxDb = (ctx: Ctx): DbClient =>
	(ctx[CTX_MEMO]?.tx as DbClient | undefined) ?? db;
