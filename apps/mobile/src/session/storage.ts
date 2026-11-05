import * as SecureStore from "expo-secure-store";
import { z } from "zod";

import { rewriteItem } from "./rewrite-item";

/** One key, holding JSON: a secure-store key allows only a few characters,
 *  and one write keeps the server and its token together. */
export const SESSION_KEY = "farmer.session";

/** "This device only": a backup restore onto a second phone must not carry
 *  the session of the first phone. */
const options: SecureStore.SecureStoreOptions = {
	keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const storedSession = z.object({
	origin: z.string().min(1),
	token: z.string().min(1),
	workspace: z.string().nullable(),
});
export type StoredSession = z.output<typeof storedSession>;

export const readSession = async (): Promise<StoredSession | null> => {
	const raw = await SecureStore.getItemAsync(SESSION_KEY, options);
	if (!raw) return null;
	try {
		const parsed = storedSession.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

export const writeSession = (session: StoredSession) =>
	SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), options);

export const wipeSession = () => SecureStore.deleteItemAsync(SESSION_KEY);

/** Write the session again, so that a session from an earlier build gets the
 *  "this device only" accessibility (see `rewriteItem`). Returns false when
 *  a step failed. Never throws. */
export const migrateSession = (): Promise<boolean> =>
	rewriteItem({
		read: () => SecureStore.getItemAsync(SESSION_KEY, options),
		remove: () => SecureStore.deleteItemAsync(SESSION_KEY, options),
		write: (value) => SecureStore.setItemAsync(SESSION_KEY, value, options),
	});
