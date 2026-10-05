import * as SecureStore from "expo-secure-store";
import { z } from "zod";

/** One key, holding JSON: a secure-store key allows only a few characters,
 *  and one write keeps the server and its token together. */
const KEY = "farmer.session";

const storedSession = z.object({
	origin: z.string().min(1),
	token: z.string().min(1),
	workspace: z.string().nullable(),
});
export type StoredSession = z.output<typeof storedSession>;

export const readSession = async (): Promise<StoredSession | null> => {
	const raw = await SecureStore.getItemAsync(KEY);
	if (!raw) return null;
	try {
		const parsed = storedSession.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

export const writeSession = (session: StoredSession) =>
	SecureStore.setItemAsync(KEY, JSON.stringify(session));

export const wipeSession = () => SecureStore.deleteItemAsync(KEY);
