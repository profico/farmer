/**
 * The mobile app's phone registration and its push settings (ADR 0006,
 * `docs/domains/mobile.md`).
 *
 * A projection, never the row. The relay id, the public key and the Live
 * Activity token go to the server and never come back: the app already has
 * them, and an answer that repeated them would put them in one more log.
 */

/** Whether this server sends native push, and through which relay. In
 *  `GET /meta`, so the app knows whether to register with the relay. A server
 *  from before the mobile push sends no `pushRelay`: treat it as off. */
export type ApiPushRelay = {
	enabled: boolean;
	/** The relay's base URL, or null while push is off. */
	url: string | null;
};

export type ApiMobilePlatform = "ios" | "android";

export type ApiMobileDevice = {
	installationId: string;
	platform: ApiMobilePlatform;
	appVersion: string;
	notificationsAllowed: boolean;
	/** Whether the server holds a Live Activity token for the phone. */
	liveActivity: boolean;
	/** ISO 8601, UTC. */
	createdAt: string;
	updatedAt: string;
};

type MobileDeviceSource = {
	installationId: string;
	platform: ApiMobilePlatform;
	appVersion: string;
	notificationsAllowed: boolean;
	liveActivity: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export const toApiMobileDevice = (
	row: MobileDeviceSource,
): ApiMobileDevice => ({
	installationId: row.installationId,
	platform: row.platform,
	appVersion: row.appVersion,
	notificationsAllowed: row.notificationsAllowed,
	liveActivity: row.liveActivity,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});
