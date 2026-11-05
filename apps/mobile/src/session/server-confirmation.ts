/**
 * The server that the person confirmed on the Server screen (ADR 0005).
 *
 * A deep link can open `farmer://sign-in?server=<address>`. The sign-in
 * screen draws the buttons and the password form of that server, so it must
 * not open for an address that the person has not confirmed. The Server
 * screen records its address here before it opens the sign-in screen. The
 * record lives in memory only, so a cold start from a deep link goes through
 * the Server screen again.
 */
let confirmed: string | null = null;

export const confirmServer = (origin: string): void => {
	confirmed = origin;
};

export const isServerConfirmed = (origin: string | null): boolean =>
	origin !== null && origin === confirmed;

export const clearServerConfirmation = (): void => {
	confirmed = null;
};
