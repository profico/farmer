import { z } from "zod";

import type { ApnsConfig } from "./delivery/apns";
import { type ServiceAccount, serviceAccountSchema } from "./delivery/fcm";

export type RelayConfig = {
	port: number;
	dbPath: string;
	trustedIpHeader: string | undefined;
	/** The most devices that the relay holds. */
	maxDevices: number;
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
	RELAY_MAX_DEVICES: z.preprocess(
		(value) => (value === "" ? undefined : value),
		z.coerce.number().int().min(1).optional(),
	),
	APNS_KEY_P8: optionalText,
	APNS_KEY_ID: optionalText,
	APNS_TEAM_ID: optionalText,
	APNS_TOPIC: optionalText,
	FCM_SERVICE_ACCOUNT_JSON: optionalText,
});

export const DEFAULT_MAX_DEVICES = 100_000;
export const DEFAULT_DB_PATH = "./data/relay.sqlite";
export const DEFAULT_APNS_TOPIC = "com.profico.farmer";

/**
 * Read the configuration from the environment. Throws on a half-set APNs
 * configuration or on service-account JSON that does not parse, so a fault
 * stops the start and does not turn into a silent dry run.
 */
export const readConfig = (
	env: Record<string, string | undefined>,
): RelayConfig => {
	const parsed = environment.parse(env);

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
		apns,
		fcm,
	};
};
