/**
 * `@farmer/api-client` — a typed client for `/api/v1`, for the mobile app
 * (and later the CLI). It never imports `@farmer/core`: the shapes it reads
 * are parsed at the boundary (`schemas.ts`) and checked against the server's
 * OpenAPI document at compile time.
 */

export { FarmerClient } from "./client";
export {
	CLI_CLIENT_ID,
	type DeviceCode,
	formatUserCode,
	MOBILE_CLIENT_ID,
	pollForToken,
	requestDeviceCode,
} from "./device-flow";
export {
	ApiClientError,
	type ApiClientErrorKind,
	type ApiIssue,
	isSignedOut,
} from "./errors";
export { assertUsable, fetchMeta } from "./meta";
export { normalizeOrigin } from "./origin";
export * from "./schemas";
export { type FetchLike, type Transport } from "./transport";
export { isVersionAtLeast } from "./version";
