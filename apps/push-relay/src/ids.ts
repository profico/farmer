import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** A relay id: 16 random bytes (128 bits), base64url. It is not a secret in
 *  the strict sense, but whoever knows it can send a push to the device, so
 *  it has the length of one. */
export const newRelayId = (): string => randomBytes(16).toString("base64url");

/** A device secret: 32 random bytes (256 bits), base64url. The relay keeps
 *  only its SHA-256 hash. */
export const newDeviceSecret = (): string =>
	randomBytes(32).toString("base64url");

/** The SHA-256 of a device secret, hex. A fast hash is correct here: the
 *  secret is 256 random bits, so nobody can guess it from its hash. */
export const hashSecret = (secret: string): string =>
	createHash("sha256").update(secret).digest("hex");

/** Compare a presented secret with a stored hash in constant time. */
export const secretMatches = (secret: string, storedHash: string): boolean => {
	const presented = Buffer.from(hashSecret(secret), "hex");
	const stored = Buffer.from(storedHash, "hex");
	return (
		presented.byteLength === stored.byteLength &&
		timingSafeEqual(presented, stored)
	);
};

/** The first characters of a relay id, for a log line. The full id lets a
 *  person send a push to the device, so a log never holds it. */
export const relayIdHint = (relayId: string): string =>
	`${relayId.slice(0, 6)}…`;
