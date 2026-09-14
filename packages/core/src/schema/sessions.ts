import { z } from "zod";

/** A better-auth session id. Not a UUID: better-auth generates its own random
 *  string ids, so the only honest shape check is "a short, non-empty string". */
export const sessionIdInput = z.string().min(1).max(255);
export type SessionIdInput = z.infer<typeof sessionIdInput>;
