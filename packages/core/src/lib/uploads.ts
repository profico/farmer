/**
 * Files people upload into the app — a project's icon, an organization's logo
 * — and the one address each of them lives at.
 *
 * Browser-safe on purpose, like `report-format.ts`: `ProjectIcon` has to tell an
 * uploaded image from an emoji, and the schemas have to refuse every path that
 * is not one of these. The bytes themselves go through `lib/storage.ts`, which
 * is server-only.
 *
 * An upload is addressed through the app (`/api/files/<key>`), never by the
 * bucket's own URL. The stored value then survives a change of bucket, host or
 * provider, the bucket stays private, and every response carries the headers
 * that make an uploaded SVG inert (see `routes/api/files/$.ts`).
 */

/** What an upload is for. The key carries it, so a stored file says what it
 *  was uploaded as. */
export const UPLOAD_PURPOSES = ["project-icon", "org-logo"] as const;

export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

/** 1 MB. An icon is drawn at 72px at the most, and a logo in a sidebar. */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

const IMAGE_TYPES = {
	png: "image/png",
	jpg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
} as const;

export type UploadExtension = keyof typeof IMAGE_TYPES;

/** For a file input's `accept`. */
export const UPLOAD_ACCEPT = Object.values(IMAGE_TYPES).join(",");

export const UPLOAD_PATH_PREFIX = "/api/files/";

// orgs/<organization id>/<purpose>/<uuid>.<extension>. The organization id is
// better-auth's, which is not a uuid.
const KEY =
	/^orgs\/([A-Za-z0-9_-]{1,64})\/(?:project-icon|org-logo)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|svg)$/;

export const uploadKey = (
	organizationId: string,
	purpose: UploadPurpose,
	id: string,
	extension: UploadExtension,
) => `orgs/${organizationId}/${purpose}/${id}.${extension}`;

export const isUploadKey = (key: string): boolean => KEY.test(key);

export const uploadPath = (key: string) => `${UPLOAD_PATH_PREFIX}${key}`;

/** The key behind an uploaded file's path, or null for anything else — an
 *  emoji, an external URL, a path of the right prefix and the wrong shape. */
export const uploadKeyOf = (
	value: string | null | undefined,
): string | null => {
	if (!value?.startsWith(UPLOAD_PATH_PREFIX)) return null;
	const key = value.slice(UPLOAD_PATH_PREFIX.length);

	return isUploadKey(key) ? key : null;
};

export const isUploadedFile = (
	value: string | null | undefined,
): value is string => uploadKeyOf(value) !== null;

/** The organization a key was uploaded under. */
export const uploadOrganizationOf = (key: string): string | null =>
	KEY.exec(key)?.[1] ?? null;

export const contentTypeOf = (extension: UploadExtension): string =>
	IMAGE_TYPES[extension];

/** The Content-Type a key is served with. It comes from the extension, which
 *  the upload chose from the bytes — never from what the browser claimed. */
export const uploadContentType = (key: string): string | null => {
	const extension = KEY.exec(key)?.[2];

	return (
		new Map<string, string>(Object.entries(IMAGE_TYPES)).get(extension ?? "") ??
		null
	);
};

/**
 * What the bytes are, read from the bytes — never from the file name or the
 * type the browser sent, both of which the uploader chooses. Null for anything
 * that is not one of the five.
 */
export const sniffImage = (bytes: Uint8Array): UploadExtension | null => {
	const at = (offset: number, signature: number[]) =>
		signature.every((byte, i) => bytes[offset + i] === byte);

	if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";

	if (at(0, [0xff, 0xd8, 0xff])) return "jpg";

	if (at(0, [0x47, 0x49, 0x46, 0x38])) return "gif";

	if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) {
		return "webp";
	}

	// SVG is text and has no magic number: the root element within the first
	// kilobyte, after whatever XML declaration, doctype or comment precedes it.
	const head = new TextDecoder()
		.decode(bytes.subarray(0, 1024))
		.replace(/^﻿/, "")
		.trimStart();

	if (head.startsWith("<") && /<svg[\s>]/i.test(head)) return "svg";

	return null;
};
