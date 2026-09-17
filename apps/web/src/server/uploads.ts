import { UPLOAD_PURPOSES } from "@farmer/core/lib/uploads";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { orgMiddleware } from "./auth";

const uploadImageForm = z.object({
	purpose: z.enum(UPLOAD_PURPOSES),
	file: z.instanceof(File, { message: "Choose an image to upload." }),
});

/**
 * Store an image and return the path to save as a project icon or an
 * organization logo — see `uploadsService.uploadImage`, which decides who may
 * and what it takes.
 *
 * FormData rather than JSON, so the bytes travel as a file part instead of a
 * base64 string a third larger than the file.
 */
export const uploadImage = createServerFn({ method: "POST" })
	.middleware([orgMiddleware])
	.validator((data: FormData) =>
		uploadImageForm.parse({
			purpose: data.get("purpose"),
			file: data.get("file"),
		}),
	)
	.handler(async ({ data, context }) => {
		const { uploadsService } = await import("@farmer/core/services");

		return uploadsService.uploadImage(context.ctx, {
			purpose: data.purpose,
			bytes: new Uint8Array(await data.file.arrayBuffer()),
		});
	});
