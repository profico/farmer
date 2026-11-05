import { z } from "zod";

// The bot token is never an input any more — it arrives from Slack's
// `oauth.v2.access` exchange inside the install callback and is written straight
// to the database, so no client, form or validator ever handles it.

export const sendTestSlackMessageInput = z.object({
	userId: z.string().min(1),
});
export type SendTestSlackMessageInput = z.infer<
	typeof sendTestSlackMessageInput
>;

export const pingPersonInput = z.object({
	userId: z.string().min(1),
});
export type PingPersonInput = z.infer<typeof pingPersonInput>;
