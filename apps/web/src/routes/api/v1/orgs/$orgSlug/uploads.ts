import type { ApiUploadedImage } from "@farmer/core/api";
import { bytesFromBase64 } from "@farmer/core/lib/uploads";
import { uploadImageInput } from "@farmer/core/schema";
import { createFileRoute } from "@tanstack/react-router";

import { apiRoute } from "#/server/api-route.ts";

/**
 * `POST /api/v1/orgs/$orgSlug/uploads` — store an image for a project icon or
 * the organization's logo, and answer its path.
 *
 * The rules of the web app's upload (`uploadsService.uploadImage`): a logo is
 * for an admin, an icon for a person who may create projects. The type comes
 * from the bytes (PNG, JPEG, GIF, WebP or SVG), and 1 MB at most. The upload
 * changes nothing: send the path as `icon` or `logo` in the PATCH of the
 * project or the organization. A file that nothing uses goes after a day.
 * 422 when this server has no store (`uploadsEnabled` in `/meta`).
 *
 * The bytes come as base64 in JSON, because each route here reads JSON.
 */
export const Route = createFileRoute("/api/v1/orgs/$orgSlug/uploads")({
	server: {
		handlers: {
			POST: apiRoute({
				input: uploadImageInput,
				run: async (ctx, input): Promise<ApiUploadedImage> => {
					const { uploadsService } = await import("@farmer/core/services");
					return uploadsService.uploadImage(ctx, {
						purpose: input.purpose,
						bytes: bytesFromBase64(input.data),
					});
				},
			}),
		},
	},
});
