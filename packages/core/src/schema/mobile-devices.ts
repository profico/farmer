import { z } from "zod";

// The mobile app's phone registration (ADR 0006, `docs/domains/mobile.md`).
// The relay id and the public key come from the relay and from the phone's
// own key pair; the server keeps them to seal and address each push.

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** An id the app makes one time for each installation. */
const installationIdSchema = z
	.string()
	.min(8)
	.max(128)
	.regex(
		/^[A-Za-z0-9._:-]+$/,
		"An installation id is letters, digits and . _ : -",
	);

/** The relay's id for the phone: base64url, as the relay makes it. */
const relayIdSchema = z
	.string()
	.min(16)
	.max(64)
	.regex(BASE64URL, "A relay id is base64url.");

/** An HMAC-SHA256 as base64url: 43 characters. */
const relayProofSchema = z
	.string()
	.regex(BASE64URL, "The relay proof is base64url.")
	.max(128);

/** The phone's P-256 public key, base64url: the 65-byte uncompressed point
 *  (87 characters) or the 64-byte `x || y` form (86 characters). The service
 *  seals a test value with it before it keeps it, so a key that is not on the
 *  curve is refused at registration and not at the first push. */
const publicKeySchema = z
	.string()
	.regex(BASE64URL, "The public key is base64url.")
	.refine(
		(value) => value.length === 86 || value.length === 87,
		"The public key is a 64- or 65-byte P-256 point.",
	);

/** A per-activity Live Activity push token (hex from ActivityKit). */
const liveActivityTokenSchema = z
	.string()
	.min(8)
	.max(512)
	.regex(/^[\x21-\x7e]+$/, "A push token is printable ASCII.");

const appVersionSchema = z.string().trim().min(1).max(32);

export const registerMobileDeviceInput = z.strictObject({
	installationId: installationIdSchema,
	platform: z.enum(["ios", "android"]),
	relayId: relayIdSchema,
	publicKey: publicKeySchema,
	/** The proof that the phone holds the relay registration: an HMAC of the
	 *  relay id and the public key, made from the device secret
	 *  (`@farmer/push-crypto/binding`). The service asks the relay to check it
	 *  when the phone takes a new relay id or a new key. */
	relayProof: relayProofSchema,
	appVersion: appVersionSchema,
	notificationsAllowed: z.boolean(),
	liveActivityToken: liveActivityTokenSchema.nullable().optional(),
});
export type RegisterMobileDeviceInput = z.infer<
	typeof registerMobileDeviceInput
>;

/** A partial patch. Null clears the Live Activity token. */
export const updateMobileDeviceInput = z
	.strictObject({
		installationId: installationIdSchema,
		liveActivityToken: liveActivityTokenSchema.nullable().optional(),
		notificationsAllowed: z.boolean().optional(),
		appVersion: appVersionSchema.optional(),
	})
	.refine(
		(input) =>
			input.liveActivityToken !== undefined ||
			input.notificationsAllowed !== undefined ||
			input.appVersion !== undefined,
		"Send at least one field to change.",
	);
export type UpdateMobileDeviceInput = z.infer<typeof updateMobileDeviceInput>;

export const removeMobileDeviceInput = z.strictObject({
	installationId: installationIdSchema,
});
export type RemoveMobileDeviceInput = z.infer<typeof removeMobileDeviceInput>;
