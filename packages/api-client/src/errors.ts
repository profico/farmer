/**
 * The one error the client throws. `kind` is what a screen branches on; the
 * message is a sentence for the person.
 */
export type ApiClientErrorKind =
	/** No answer: no network, a wrong address, a timeout. */
	| "unreachable"
	/** The address sent the request on to another address. A second try ends
	 *  the same way: the person has to change the address. */
	| "redirected"
	/** The address answers, but not as a Farmer server. */
	| "not_farmer"
	/** The server has the API switched off (`CLI_ENABLED=false`). */
	| "api_disabled"
	/** The server asks for a newer app (`minMobileVersion`). */
	| "update_required"
	/** The token is dead: revoked, expired or not valid. Sign in again. */
	| "unauthorized"
	/** The token is good, but not for this workspace. */
	| "no_access"
	/** A 2xx answer the client cannot read. */
	| "invalid_response"
	/** Any other refusal, with the server's own sentence. */
	| "http";

export type ApiIssue = { path: string; message: string };

export type ApiClientErrorDetails = {
	status?: number;
	/** The `code` of the server's `ApiError` body, when it sent one. */
	code?: string;
	issues?: ApiIssue[];
};

export class ApiClientError extends Error {
	readonly kind: ApiClientErrorKind;
	readonly status?: number;
	readonly code?: string;
	readonly issues: ApiIssue[];

	constructor(
		kind: ApiClientErrorKind,
		message: string,
		details: ApiClientErrorDetails = {},
	) {
		super(message);
		this.name = "ApiClientError";
		this.kind = kind;
		this.status = details.status;
		this.code = details.code;
		this.issues = details.issues ?? [];
	}
}

/** True when the error means the stored credential must go. */
export const isSignedOut = (error: Error) =>
	error instanceof ApiClientError && error.kind === "unauthorized";
