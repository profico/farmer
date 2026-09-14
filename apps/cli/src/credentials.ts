import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

/** The keyring service name. The entry name is the server origin, so one
 *  person can be signed in to two Farmer servers at once. */
export const KEYRING_SERVICE = "farmer-cli";

export type Keyring = {
	get: (origin: string) => Promise<string | null>;
	set: (origin: string, token: string) => Promise<void>;
	delete: (origin: string) => Promise<void>;
};

export const systemKeyring: Keyring = {
	get: (origin) => Bun.secrets.get({ service: KEYRING_SERVICE, name: origin }),
	set: (origin, token) =>
		Bun.secrets.set({ service: KEYRING_SERVICE, name: origin, value: token }),
	delete: async (origin) => {
		await Bun.secrets.delete({ service: KEYRING_SERVICE, name: origin });
	},
};

export type TokenLocation = "keyring" | "file";

export type CredentialStore = {
	get: (origin: string) => Promise<string | null>;
	/** Says where the token went, so the caller can tell the person when it
	 *  had to be a file. */
	set: (origin: string, token: string) => Promise<TokenLocation>;
	delete: (origin: string) => Promise<void>;
};

const credentialsFile = z.object({
	tokens: z.array(z.object({ origin: z.string(), token: z.string() })),
});
type CredentialsFile = z.infer<typeof credentialsFile>;

const readTokens = async (path: string): Promise<CredentialsFile> => {
	const file = Bun.file(path);
	if (!(await file.exists())) return { tokens: [] };
	try {
		const parsed = credentialsFile.safeParse(JSON.parse(await file.text()));
		// A damaged file costs a new `farmer login`, not a crash on every command.
		return parsed.success ? parsed.data : { tokens: [] };
	} catch {
		return { tokens: [] };
	}
};

const writeTokens = async (path: string, data: CredentialsFile) => {
	if (data.tokens.length === 0) {
		await rm(path, { force: true });
		return;
	}
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFile(path, `${JSON.stringify(data, null, "\t")}\n`, {
		mode: 0o600,
	});
	// `mode` applies only when the file is created. A file that already existed
	// with wider permissions keeps them unless they are set again.
	await chmod(path, 0o600);
};

/**
 * The token lives in the system keyring, and in `credentials.json` (mode 0600)
 * only when there is no keyring to use — a Linux server with no desktop
 * session has no Secret Service, and `Bun.secrets` throws there.
 *
 * `keyring` is null when `FARMER_NO_KEYRING=1`, which skips the keyring on a
 * machine where it exists but prompts or hangs (a locked keyring over SSH).
 *
 * A read checks both places, because a token written to the file while the
 * keyring was unavailable must still be found once it is available again.
 */
export const createCredentialStore = (
	keyring: Keyring | null,
	filePath: string,
): CredentialStore => {
	const removeFromFile = async (origin: string) => {
		const data = await readTokens(filePath);
		const kept = data.tokens.filter((entry) => entry.origin !== origin);
		if (kept.length !== data.tokens.length) {
			await writeTokens(filePath, { tokens: kept });
		}
	};

	return {
		get: async (origin) => {
			if (keyring) {
				try {
					const token = await keyring.get(origin);
					if (token) return token;
				} catch {
					// No usable keyring: the file below is the only other place.
				}
			}
			const data = await readTokens(filePath);
			return (
				data.tokens.find((entry) => entry.origin === origin)?.token ?? null
			);
		},
		set: async (origin, token) => {
			if (keyring) {
				try {
					await keyring.set(origin, token);
					await removeFromFile(origin);
					return "keyring";
				} catch {
					// Fall through to the file.
				}
			}
			const data = await readTokens(filePath);
			await writeTokens(filePath, {
				tokens: [
					...data.tokens.filter((entry) => entry.origin !== origin),
					{ origin, token },
				],
			});
			return "file";
		},
		delete: async (origin) => {
			if (keyring) {
				try {
					await keyring.delete(origin);
				} catch {
					// Nothing to delete where there is no keyring.
				}
			}
			await removeFromFile(origin);
		},
	};
};
