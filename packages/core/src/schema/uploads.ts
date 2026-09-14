import { z } from "zod";

import { isUploadedFile } from "../lib/uploads";

/**
 * The path of an image stored by `uploadsService.uploadImage`. This checks the
 * shape and nothing else — which organization the file belongs to is
 * `assertOwnUpload`'s question, and a schema cannot answer it.
 */
export const uploadedFilePath = z
	.string()
	.refine(isUploadedFile, "Not an uploaded image");
