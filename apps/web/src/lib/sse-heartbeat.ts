// A heartbeat for a long server-sent event stream.
//
// `server.ts` closes a connection that sends nothing for `idleTimeout` (255 s).
// An assistant turn can be silent for longer than that: a model that thinks, a
// stall and its retry, and a slow tool can follow each other. A proxy in front
// of the host can have a shorter limit. A comment line keeps bytes on the wire
// and is not an event: the client reads only the `data:` lines.

/** An SSE comment. Every SSE reader ignores a line that starts with a colon. */
export const SSE_HEARTBEAT = new TextEncoder().encode(": heartbeat\n\n");

/** Well below the host's 255 s idle limit, and below a common 60 s proxy. */
export const SSE_HEARTBEAT_MS = 20_000;

/**
 * Call `beat` every `intervalMs` until the returned function is called. Call
 * that function on every exit path, or the timer keeps the turn's closure
 * alive and writes to a closed stream.
 */
export const startHeartbeat = (
	beat: () => void,
	intervalMs: number = SSE_HEARTBEAT_MS,
): (() => void) => {
	const timer = setInterval(beat, intervalMs);
	return () => clearInterval(timer);
};
