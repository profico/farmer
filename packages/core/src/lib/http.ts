// Every call this app makes to somebody else's server.
//
// It exists for one reason: `fetch` has no default timeout. A socket that opens
// and then never answers hangs the awaiting promise forever, and the automation
// sweep (jobs/automation-sync.ts) awaits one user's engines before starting the
// next, behind a `running` flag that refuses to start a new tick while the old
// one is in flight. So a single wedged request to Google or GitHub did not
// degrade the sweep — it ENDED it, silently, until someone restarted the
// process. Nothing logged, because nothing threw.
//
// A timeout is the fix at the right layer. The per-user bound in the sweep is a
// backstop for everything else that could be slow; this is the thing that
// actually goes wrong.

/**
 * A duration in milliseconds from an environment variable.
 *
 * An unset, empty or invalid value gives `fallback`. `Number("")` is 0, so an
 * empty variable in a compose file or a copied `.env.example` used to set a
 * deadline of 0 ms, and every call failed at once. A negative value is invalid.
 *
 * 0 gives `fallback` too, because a deadline of 0 ms is never what an operator
 * wants. Only a limit that 0 turns off passes `zero: "off"`, and then an
 * explicit 0 is returned as 0. Two limits use it:
 * `OPENROUTER_STALL_TIMEOUT_MS` (0 means no watchdog) and
 * `SHUTDOWN_GRACE_MS` (0 is a valid grace: stop at once, with no wait).
 */
export const durationFromEnv = (
	raw: string | undefined,
	fallback: number,
	zero: "off" | "fallback" = "fallback",
): number => {
	const trimmed = raw?.trim();
	if (!trimmed) return fallback;
	const value = Number(trimmed);
	if (!Number.isFinite(value) || value < 0) return fallback;
	if (value === 0) return zero === "off" ? 0 : fallback;
	return value;
};

/** Long enough for a cold Google/GitHub page fetch on a bad day, short enough
 *  that a wedged socket costs one tick rather than every future one. */
export const EXTERNAL_FETCH_TIMEOUT_MS = durationFromEnv(
	process.env.EXTERNAL_FETCH_TIMEOUT_MS,
	15_000,
);

/**
 * `fetch` with a deadline.
 *
 * On timeout this rejects with a `TimeoutError` from `AbortSignal.timeout`,
 * which every caller already handles the same way it handles a network error —
 * the integration services turn a throw into "couldn't read", and the engines
 * bail without deleting on a read they merely failed to make.
 *
 * A caller-supplied `signal` still composes: `AbortSignal.any` means the request
 * ends at whichever comes first, so this cannot quietly extend a cancellation.
 */
export const externalFetch = (
	input: string | URL | Request,
	init: RequestInit = {},
	timeoutMs: number = EXTERNAL_FETCH_TIMEOUT_MS,
): Promise<Response> => {
	const deadline = AbortSignal.timeout(timeoutMs);
	return fetch(input, {
		...init,
		signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
	});
};

/**
 * Run `work`, but give up after `ms`.
 *
 * The backstop the note above mentions: the sweep wraps each person's pass in
 * this, so anything slow that is NOT an outbound fetch — a lock wait on a
 * connection pool, a pathological query — costs one person's tick instead of
 * every subsequent one. `onTimeout` names what was abandoned, for the log line.
 *
 * The abandoned promise keeps running; there is nothing to cancel it and nothing
 * that needs to be. Every engine under it is idempotent, so a late write lands
 * on work the next tick would have done anyway.
 */
export const withTimeout = async <T>(
	work: Promise<T>,
	ms: number,
	onTimeout: () => Error,
): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => {
					reject(onTimeout());
				}, ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};
