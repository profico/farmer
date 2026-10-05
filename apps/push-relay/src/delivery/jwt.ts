/** Small helpers to sign a JWT with WebCrypto. No JWT library: the relay
 *  signs two fixed token shapes and verifies none. */

const encoder = new TextEncoder();

const base64UrlJson = (value: Record<string, string | number>): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * The DER bytes of a PKCS #8 PEM key. An environment variable often holds the
 * key with literal `\n` sequences in place of line breaks, so those count as
 * line breaks too.
 */
export const pemToDer = (pem: string): ArrayBuffer => {
	const body = pem
		.replace(/\\n/g, "\n")
		.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
		.replace(/\s+/g, "");
	const bytes = Buffer.from(body, "base64");
	const copy = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(copy).set(bytes);
	return copy;
};

export type JwtAlgorithm = "ES256" | "RS256";

const SIGN_PARAMS = {
	ES256: { name: "ECDSA", hash: "SHA-256" },
	RS256: { name: "RSASSA-PKCS1-v1_5" },
} satisfies Record<JwtAlgorithm, AlgorithmIdentifier | EcdsaParams>;

const IMPORT_PARAMS = {
	ES256: { name: "ECDSA", namedCurve: "P-256" },
	RS256: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
} satisfies Record<JwtAlgorithm, EcKeyImportParams | RsaHashedImportParams>;

/** Import a PKCS #8 PEM private key for signing. Throws on a bad key, so a
 *  wrong environment variable fails at start and not at the first push. */
export const importSigningKey = (
	pem: string,
	algorithm: JwtAlgorithm,
): Promise<CryptoKey> =>
	crypto.subtle.importKey(
		"pkcs8",
		pemToDer(pem),
		IMPORT_PARAMS[algorithm],
		false,
		["sign"],
	);

/**
 * Sign a JWT. For ES256, WebCrypto gives the signature as `r || s` (64 bytes),
 * which is the form JWS wants, so no DER conversion is necessary.
 */
export const signJwt = async (
	key: CryptoKey,
	algorithm: JwtAlgorithm,
	header: Record<string, string>,
	claims: Record<string, string | number>,
): Promise<string> => {
	const input = `${base64UrlJson({ ...header, alg: algorithm })}.${base64UrlJson(claims)}`;
	const signature = await crypto.subtle.sign(
		SIGN_PARAMS[algorithm],
		key,
		encoder.encode(input),
	);
	return `${input}.${Buffer.from(signature).toString("base64url")}`;
};
