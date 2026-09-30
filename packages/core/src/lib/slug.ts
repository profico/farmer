export const slugify = (input: string): string =>
	input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "") || "org";

/**
 * Slugs no organization may take, because the first path segment is shared.
 *
 * An organization lives at `/<slug>`, and the web app's own pages live beside
 * it: `/about`, `/login`, `/api/…`. The router prefers a static route to
 * `$orgSlug`, so an organization called "About" would get `/about` and never
 * see its own workspace there. Every top-level route and every top-level
 * directory under `public/` is here, and `reserved-slugs.test.ts` in apps/web
 * fails when a new route is not. The rest keep names free for pages the
 * product may grow, so adding one later cannot strand an organization.
 *
 * `_` and `:org` are the placeholders of `lib/org-redirect.ts` in apps/web.
 * Neither passes `isWellFormedSlug` anyway; they are listed so the one list says
 * everything a slug cannot be.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	// Top-level routes (apps/web/src/routes).
	"about",
	"accept-invite",
	"api",
	"changelog",
	"choose-organization",
	"cli",
	"device",
	"early-access",
	"login",
	// The MCP OAuth consent screen. An organization with this slug would hide
	// it from everyone.
	"mcp-consent",
	"no-access",
	"privacy",
	"self-hosting",
	"terms",
	// Top-level directories of apps/web/public and the build output.
	"assets",
	"fonts",
	// Kept free for the product.
	"account",
	"admin",
	"app",
	"blog",
	"dashboard",
	"docs",
	"help",
	"logout",
	"new",
	"pricing",
	"settings",
	"signup",
	"static",
	"status",
	"support",
	// The placeholders.
	"_",
	":org",
]);

/** What `slugify` produces: lowercase letters and digits in runs, joined by
 *  single hyphens. */
export const isWellFormedSlug = (slug: string): boolean =>
	/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);

export const isReservedSlug = (slug: string): boolean =>
	RESERVED_SLUGS.has(slug);

/**
 * Why `slug` cannot name an organization, or null when it can. Whether another
 * organization already has it is a separate question, for the database.
 */
export const slugProblem = (slug: string): string | null => {
	if (!isWellFormedSlug(slug)) {
		return "A slug can hold only lowercase letters, digits and single hyphens.";
	}
	if (isReservedSlug(slug)) {
		return `"${slug}" is the address of a page of this app. Choose another slug.`;
	}
	return null;
};
