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
export * from "./bodies";
export { type JsonValue, jsonValueSchema } from "./json";
export * from "./schemas";
export * from "./schemas-account";
export * from "./schemas-admin";
export * from "./schemas-assistant";
export * from "./schemas-day";
export * from "./schemas-member";
export * from "./schemas-onboarding";
export * from "./schemas-people";
export { parseAssistantEvent, readAssistantEvents, SseDecoder } from "./sse";
export {
	type FetchInit,
	type FetchLike,
	type FetchResponse,
	type Transport,
} from "./transport";
export { isVersionAtLeast } from "./version";
