import { z } from "zod";

import type { ApnsConfig } from "./delivery/apns";
import { type ServiceAccount, serviceAccountSchema } from "./delivery/fcm";

export type RelayConfig = {
	port: number;
	dbPath: string;
	trustedIpHeader: string | undefined;
	maxDevices: number;
	/** True: `POST /v1/push` needs a server key. */
	requireServerKey: boolean;
	/** Null: no APNs credentials, so iOS pushes are a dry run. */
	apns: ApnsConfig | null;
	/** Null: no FCM credentials, so Android pushes are a dry run. */
	fcm: ServiceAccount | null;
};

const optionalText = z
	.string()
	.trim()
	.transform((value) => (value === "" ? undefined : value))
	.optional();

const environment = z.object({
	PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
	RELAY_DB_PATH: optionalText,
	TRUSTED_IP_HEADER: z.string().optional(),
	NODE_ENV: z.string().optional(),
	RELAY_MAX_DEVICES: z.preprocess(
		(value) => (value === "" ? undefined : value),
		z.coerce.number().int().min(1).optional(),
	),
	REQUIRE_SERVER_KEY: z.preprocess(
		(value) => (value === "" ? undefined : value),
		z.enum(["true", "false"]).default("false"),
	),
	APNS_KEY_P8: optionalText,
	APNS_KEY_ID: optionalText,
	APNS_TEAM_ID: optionalText,
	APNS_TOPIC: optionalText,
	FCM_SERVICE_ACCOUNT_JSON: optionalText,
});

const HEADER_NAME = /^[a-z0-9-]+$/i;

export const DEFAULT_MAX_DEVICES = 100_000;
export const DEFAULT_DB_PATH = "./data/relay.sqlite";
export const DEFAULT_APNS_TOPIC = "com.profico.farmer";

/** Refuse a value that is not a header name or `none`. A bad name would make
 *  every request fail in the runtime. */
const checkTrustedIpHeader = (value: string | undefined): void => {
	const header = value?.trim() ?? "";
	if (header === "" || header.toLowerCase() === "none") return;
	if (!HEADER_NAME.test(header)) {
		throw new Error(
			"TRUSTED_IP_HEADER is not a header name: use letters, digits and hyphens, or none.",
		);
	}
};

/**
 * Read the configuration from the environment. Throws on a half-set APNs
 * configuration or on service-account JSON that does not parse, so a fault
 * stops the start and does not turn into a silent dry run.
 */
export const readConfig = (
	env: Record<string, string | undefined>,
): RelayConfig => {
	const parsed = environment.parse(env);

	checkTrustedIpHeader(parsed.TRUSTED_IP_HEADER);

	// With no value in production, every phone would share the proxy's
	// address and one rate-limit bucket. `none` states that no proxy is in
	// front of the relay.
	if (parsed.NODE_ENV === "production" && !parsed.TRUSTED_IP_HEADER?.trim()) {
		throw new Error(
			"Set TRUSTED_IP_HEADER in production: the header that the proxy sets with the client address, or none for a relay with no proxy in front.",
		);
	}

	const apnsParts = [
		parsed.APNS_KEY_P8,
		parsed.APNS_KEY_ID,
		parsed.APNS_TEAM_ID,
	];
	const apnsSet = apnsParts.filter((part) => part !== undefined).length;
	if (apnsSet !== 0 && apnsSet !== apnsParts.length) {
		throw new Error(
			"Set all of APNS_KEY_P8, APNS_KEY_ID and APNS_TEAM_ID, or none of them.",
		);
	}
	const apns =
		parsed.APNS_KEY_P8 && parsed.APNS_KEY_ID && parsed.APNS_TEAM_ID
			? {
					keyP8: parsed.APNS_KEY_P8,
					keyId: parsed.APNS_KEY_ID,
					teamId: parsed.APNS_TEAM_ID,
					topic: parsed.APNS_TOPIC ?? DEFAULT_APNS_TOPIC,
				}
			: null;

	let fcm: ServiceAccount | null = null;
	if (parsed.FCM_SERVICE_ACCOUNT_JSON) {
		try {
			fcm = serviceAccountSchema.parse(
				JSON.parse(parsed.FCM_SERVICE_ACCOUNT_JSON),
			);
		} catch {
			// The message of the cause could quote the private key.
			throw new Error(
				"FCM_SERVICE_ACCOUNT_JSON is not a service account key file.",
			);
		}
	}

	return {
		port: parsed.PORT,
		dbPath: parsed.RELAY_DB_PATH ?? DEFAULT_DB_PATH,
		trustedIpHeader: parsed.TRUSTED_IP_HEADER,
		maxDevices: parsed.RELAY_MAX_DEVICES ?? DEFAULT_MAX_DEVICES,
		requireServerKey: parsed.REQUIRE_SERVER_KEY === "true",
		apns,
		fcm,
	};
};
