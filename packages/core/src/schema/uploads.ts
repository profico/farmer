import { z } from "zod";

import {
	isUploadedFile,
	MAX_UPLOAD_BASE64_LENGTH,
	UPLOAD_PURPOSES,
} from "../lib/uploads";

/**
 * The path of an image stored by `uploadsService.uploadImage`. This checks the
 * shape and nothing else — which organization the file belongs to is
 * `assertOwnUpload`'s question, and a schema cannot answer it.
 */
export const uploadedFilePath = z
	.string()
	.refine(isUploadedFile, "Not an uploaded image");

/**
 * An image for `POST /api/v1/orgs/$slug/uploads`, as base64 in a JSON body.
 * The web app sends a file part. The REST API reads only JSON, and a phone's
 * image picker gives base64. The length cap is the 1 MB limit after the
 * decode, so a body that is too large stops here.
 */
export const uploadImageInput = z.object({
	purpose: z.enum(UPLOAD_PURPOSES),
	data: z
		.base64()
		.max(MAX_UPLOAD_BASE64_LENGTH)
		.describe("The image bytes, base64. No `data:` prefix. 1 MB at most."),
});
export type UploadImageInput = z.infer<typeof uploadImageInput>;
