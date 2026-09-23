/**
 * An error whose `message` is written for the person who caused it.
 *
 * Exposure is a property of the error, not of the call site: a class that
 * extends this one promises that its message names nothing a caller outside
 * this process may not read — no SQL, no hostname, no address, no URL, no
 * credential. `classifyServiceError` (`services/error-message.ts`) admits
 * every instance, so the CLI's API, the MCP server and the assistant's tool
 * results all pass it through.
 *
 * Extend it only when EVERY message the class can carry keeps that promise.
 * A class that may carry detail keeps it in its own field (the GitHub errors
 * keep the URL on `url`), or stays a plain `Error` subclass — which is why
 * `WebhookUrlRefusedError` (its reason can name a resolved private address),
 * `OpenRouterError` (a provider's body) and `ObjectStoreError` (the bucket's
 * answer) do not extend it.
 *
 * It lives in `lib/` because the integration clients throw it too, and `lib/`
 * does not import from `services/`.
 */
export class UserFacingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserFacingError";
	}
}
