import { z } from "zod";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The longest ciphertext the relay forwards, in base64url characters. APNs
 *  and FCM both cap a payload at 4 KB, and the envelope needs the rest. */
export const MAX_CIPHERTEXT_LENGTH = 3_072;

/** The largest `contentState`, as JSON, in bytes. */
export const MAX_CONTENT_STATE_BYTES = 1_024;

/** An APNs device token (hex) or an FCM registration token. Both are
 *  printable ASCII; FCM's are about 160 characters. */
const pushToken = z
	.string()
	.min(8)
	.max(512)
	.regex(/^[\x21-\x7e]+$/, "A push token is printable ASCII.");

export const relayIdSchema = z
	.string()
	.min(16)
	.max(64)
	.regex(BASE64URL, "A relay id is base64url.");

const platform = z.enum(["ios", "android"]);
const apnsEnvironment = z.enum(["production", "sandbox"]);

export const registerDeviceBody = z.strictObject({
	platform,
	pushToken,
	apnsEnvironment: apnsEnvironment.optional(),
	liveActivityPushToStartToken: pushToken.optional(),
});
export type RegisterDeviceBody = z.infer<typeof registerDeviceBody>;

export const updateDeviceBody = z
	.strictObject({
		pushToken: pushToken.optional(),
		apnsEnvironment: apnsEnvironment.optional(),
		/** Null clears the token. */
		liveActivityPushToStartToken: pushToken.nullable().optional(),
	})
	.refine(
		(body) =>
			body.pushToken !== undefined ||
			body.apnsEnvironment !== undefined ||
			body.liveActivityPushToStartToken !== undefined,
		"Send at least one field to change.",
	);
export type UpdateDeviceBody = z.infer<typeof updateDeviceBody>;

/** A value in a Live Activity's content state or attributes: a primitive, so
 *  the relay forwards the object without a look into nested data. */
const primitive = z.union([
	z.string().max(256),
	z.number(),
	z.boolean(),
	z.null(),
]);
const primitiveMap = z.record(z.string().min(1).max(64), primitive);

const unixSeconds = z.number().int().positive();

const liveActivity = z.strictObject({
	/** The per-activity push token. Absent means push-to-start: the relay
	 *  uses the device's push-to-start token. */
	token: pushToken.optional(),
	event: z.enum(["start", "update", "end"]),
	contentState: primitiveMap.refine(
		(state) =>
			Buffer.byteLength(JSON.stringify(state)) <= MAX_CONTENT_STATE_BYTES,
		`contentState is at most ${MAX_CONTENT_STATE_BYTES} bytes as JSON.`,
	),
	staleDate: unixSeconds.optional(),
	dismissalDate: unixSeconds.optional(),
	/** The Swift type name of the ActivityAttributes, for a push-to-start. */
	attributesType: z
		.string()
		.max(64)
		.regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
		.optional(),
	attributes: primitiveMap.optional(),
});
export type LiveActivityPush = z.infer<typeof liveActivity>;

export const pushBody = z
	.strictObject({
		relayId: relayIdSchema,
		kind: z.enum(["alert", "data", "liveactivity"]),
		ciphertext: z
			.string()
			.min(1)
			.max(MAX_CIPHERTEXT_LENGTH)
			.regex(BASE64URL, "The ciphertext is base64url."),
		liveActivity: liveActivity.optional(),
	})
	.superRefine((body, context) => {
		if ((body.kind === "liveactivity") !== (body.liveActivity !== undefined)) {
			context.addIssue({
				code: "custom",
				path: ["liveActivity"],
				message:
					"liveActivity is required for kind liveactivity, and only then.",
			});
			return;
		}
		const activity = body.liveActivity;
		if (!activity || activity.token !== undefined) return;
		if (activity.event !== "start") {
			context.addIssue({
				code: "custom",
				path: ["liveActivity", "token"],
				message: "Only a start event can go without an activity token.",
			});
		} else if (!activity.attributesType || !activity.attributes) {
			context.addIssue({
				code: "custom",
				path: ["liveActivity", "attributes"],
				message: "A push-to-start needs attributesType and attributes.",
			});
		}
	});
export type PushBody = z.infer<typeof pushBody>;
