import { z } from "zod";

/**
 * The plaintext of a sealed push, as `packages/core/src/services/native-push.ts`
 * writes it. Every field is parsed: a payload of a newer Server that this
 * app cannot read is dropped, not shown half.
 */

/** An alert: `{ kind, title, body, url? }`. `url` is a web path. */
export const alertPayload = z.object({
	kind: z.string(),
	title: z.string(),
	body: z.string(),
	url: z.string().optional(),
});
export type AlertPayload = z.output<typeof alertPayload>;

/** The content state of the timer: numbers and the workspace slug. */
export const timerContentState = z.object({
	state: z.enum(["running", "held"]),
	/** Unix milliseconds on the Server's clock, or null while held. */
	runningSinceMs: z.number().nullable(),
	accumulatedSeconds: z.number(),
	workspace: z.string().optional(),
});
export type TimerContentState = z.output<typeof timerContentState>;

/** A timer change. Android gets the content state in the sealed part. */
export const timerPayload = z.discriminatedUnion("event", [
	z.object({
		kind: z.literal("timer"),
		event: z.literal("end"),
		state: timerContentState.optional(),
	}),
	z.object({
		kind: z.literal("timer"),
		event: z.enum(["start", "update"]),
		workspace: z.string(),
		project: z.string().nullable(),
		task: z.string(),
		state: timerContentState.optional(),
	}),
]);
export type TimerPayload = z.output<typeof timerPayload>;

/** The FCM data map of the relay: string values only. */
export const fcmData = z.object({
	e: z.string().min(1),
	k: z.enum(["alert", "data", "liveactivity"]).optional(),
});

/** The data of a local notification that the app showed for a push. The
 *  foreground handler shows it, and a tap opens `path`. */
export const localAlertData = z.object({
	farmer: z.literal("alert"),
	path: z.string(),
	workspace: z.string().nullable(),
});
export type LocalAlertData = z.output<typeof localAlertData>;

/** Where a web path from the Server opens in the app. The Server writes the
 *  paths of the web app (`/<slug>/time`, `/<slug>/reports?tab=...`); the app
 *  has its own routes, so a path it does not know opens the Time tab. */
export type AppTarget = { path: string; workspace: string | null };

export const appTargetOf = (url: string | undefined): AppTarget => {
	if (!url?.startsWith("/")) return { path: "/", workspace: null };
	const [slug, section, sub] = url.split("?")[0]?.split("/").slice(1) ?? [];
	const workspace = slug ? decodeURIComponent(slug) : null;
	switch (section) {
		case "reports":
			return { path: "/reports", workspace };
		case "settings":
			return sub === "webhooks"
				? { path: "/workspace/webhooks", workspace }
				: { path: "/", workspace };
		default:
			return { path: "/", workspace };
	}
};
