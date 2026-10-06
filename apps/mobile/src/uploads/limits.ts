import type { ImageUpload } from "@farmer/api-client";

// The pure rules of an image upload. `pick-image.ts` applies them on the
// phone.

export type UploadPurpose = ImageUpload["purpose"];

/** 1 MB, the limit of the server: `MAX_UPLOAD_BYTES` in
 *  `packages/core/src/lib/uploads.ts`. The app does not import the core. */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

/** The longest base64 text of a file of `MAX_UPLOAD_BYTES`, as the server
 *  computes it (`MAX_UPLOAD_BASE64_LENGTH`). */
export const MAX_UPLOAD_BASE64_LENGTH = 4 * Math.ceil(MAX_UPLOAD_BYTES / 3);

/** The longest side of the stored image, in pixels. The web draws an icon
 *  at 72 px at most, and a logo in the sidebar. */
export const MAX_SIDE = {
	"project-icon": 256,
	"org-logo": 512,
} satisfies { [purpose in UploadPurpose]: number };

/** The size to resize to, or null when the image is already small enough.
 *  The image is never made larger. */
export const resizeTarget = (
	width: number,
	height: number,
	maxSide: number,
): { width: number } | { height: number } | null => {
	if (Math.max(width, height) <= maxSide) return null;
	return width >= height ? { width: maxSide } : { height: maxSide };
};

/** True when the server accepts a base64 text of this length. */
export const fitsUploadLimit = (base64: string) =>
	base64.length <= MAX_UPLOAD_BASE64_LENGTH;

/** True for a type that can have transparent pixels. Such an image is
 *  stored as PNG first, so that the transparency stays. */
export const mayHaveAlpha = (mimeType: string | undefined) =>
	mimeType === "image/png" ||
	mimeType === "image/gif" ||
	mimeType === "image/webp";

/** True for the path of an uploaded SVG. React Native's `Image` cannot draw
 *  an SVG, so the app shows the letter or the initials for it. */
export const isSvgUpload = (path: string) =>
	path.toLowerCase().endsWith(".svg");
