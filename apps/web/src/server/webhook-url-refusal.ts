/**
 * Run a webhook write and give a refused URL its reason, for the REST routes.
 *
 * `WebhookUrlRefusedError` is not a `UserFacingError`, so the API's error
 * mapping answers it with a generic 500, and the MCP server and the
 * assistant never read it (`services/error-message.test.ts`). The web page
 * shows the reason as a field error, so the admin can fix the URL. The
 * REST routes of the webhooks are admin only, as the page is, so they
 * answer the same reason with a 422. A reason names the host that the admin
 * typed and never the address it resolved to (`lib/webhook-url.ts`).
 */
export const withUrlRefusalReason = async <T>(
	write: () => Promise<T>,
): Promise<T> => {
	const { UserFacingError, WebhookUrlRefusedError } =
		await import("@farmer/core/services");
	try {
		return await write();
	} catch (error) {
		if (error instanceof WebhookUrlRefusedError) {
			throw new UserFacingError(error.message);
		}
		throw error;
	}
};
