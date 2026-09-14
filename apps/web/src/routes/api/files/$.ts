import { createFileRoute } from "@tanstack/react-router";

// Every uploaded image — project icons, organization logos — is served from
// here, not from the bucket (see packages/core/src/lib/uploads.ts).
//
// No authentication, on purpose: `/login` shows the single-org logo to people
// who have not signed in yet. A key carries a random uuid, so nobody reaches a
// file without having been shown its path.
//
// The response is the part that needs care. An SVG is a document that can run
// script, and this one comes from the app's own origin, so opened directly it
// would run with the app's cookies in reach. The CSP `sandbox` puts it in an
// opaque origin and `default-src 'none'` stops it loading anything; an `<img>`
// never runs script either way. `nosniff` holds the browser to the stated type.
// A key never changes content, since a new upload is a new key, so it is cached
// for good.
const NOT_FOUND = () => new Response("Not found", { status: 404 });

export const Route = createFileRoute("/api/files/$")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const key = params._splat ?? "";
				const { isUploadKey, uploadContentType } =
					await import("@farmer/core/lib/uploads");
				const contentType = uploadContentType(key);
				if (!isUploadKey(key) || !contentType) return NOT_FOUND();

				const { objectStore } = await import("@farmer/core/lib/storage");
				const store = objectStore();
				if (!store) return NOT_FOUND();

				const object = await store.get(key);
				if (!object) return NOT_FOUND();

				const headers = new Headers({
					"content-type": contentType,
					"cache-control": "public, max-age=31536000, immutable",
					"x-content-type-options": "nosniff",
					"content-security-policy":
						"default-src 'none'; style-src 'unsafe-inline'; sandbox",
				});
				if (object.size !== null) {
					headers.set("content-length", String(object.size));
				}
				return new Response(object.body, { headers });
			},
		},
	},
});
