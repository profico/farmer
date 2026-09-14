import { objectStore } from "../lib/storage";
import {
	contentTypeOf,
	MAX_UPLOAD_BYTES,
	sniffImage,
	type UploadPurpose,
	uploadKey,
	uploadKeyOf,
	uploadOrganizationOf,
	uploadPath,
} from "../lib/uploads";
import { ctxAccess, requireAdmin } from "./context";
import type { Ctx } from "./types";

/** An upload the app will not take: no store, too big, not an image. The
 *  message is written for the person who chose the file. */
export class UploadRejectedError extends Error {}

export const uploadsService = {
	/**
	 * Store an image and return the path to save as a project's icon or an
	 * organization's logo.
	 *
	 * Uploading sets nothing. The path is saved by the same update that saves
	 * an emoji or a URL, so a picker closed without saving leaves the project as
	 * it was — and leaves an unreferenced object behind, which at 1 MB and one
	 * per change of mind is cheaper than a sweep that has to know every column
	 * that may hold a path.
	 */
	uploadImage: async (
		ctx: Ctx,
		input: { purpose: UploadPurpose; bytes: Uint8Array<ArrayBuffer> },
	) => {
		// Who before what: somebody who may not set the image learns nothing
		// about whether this file would have been accepted.
		if (input.purpose === "org-logo") {
			await requireAdmin(ctx);
		} else {
			// The dialog that creates a project offers the picker, so the gate is
			// the one on creating projects rather than on managing one of them. It
			// admits everyone who can manage a project, too: PM outranks Team Lead.
			(await ctxAccess(ctx)).assertCanCreateProjects();
		}

		const store = objectStore();
		if (!store) {
			throw new UploadRejectedError(
				"File uploads are not set up on this deployment.",
			);
		}
		if (input.bytes.byteLength === 0) {
			throw new UploadRejectedError("The file is empty.");
		}
		if (input.bytes.byteLength > MAX_UPLOAD_BYTES) {
			throw new UploadRejectedError("The image is larger than 1 MB.");
		}
		const extension = sniffImage(input.bytes);
		if (!extension) {
			throw new UploadRejectedError(
				"Upload a PNG, JPEG, GIF, WebP or SVG image.",
			);
		}

		const key = uploadKey(
			ctx.organizationId,
			input.purpose,
			crypto.randomUUID(),
			extension,
		);
		await store.put(key, input.bytes, contentTypeOf(extension));
		return { url: uploadPath(key) };
	},
};

/**
 * Refuse an uploaded file that belongs to another organization.
 *
 * The schemas can check a path's shape and nothing more, and a path is no
 * secret once it has been on a page. Without this, a project could wear
 * another workspace's logo — one that workspace may still replace, and that
 * would change here too. Anything that is not an upload passes untouched.
 */
export const assertOwnUpload = (ctx: Ctx, value: string | null | undefined) => {
	const key = uploadKeyOf(value);
	if (key && uploadOrganizationOf(key) !== ctx.organizationId) {
		throw new UploadRejectedError(
			"That image was uploaded to another organization.",
		);
	}
};
