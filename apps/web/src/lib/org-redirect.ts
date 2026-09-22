/**
 * Links that name no organization, and the one rule for where a redirect may
 * point.
 *
 * A person can share `/:org/settings` (or `/_/settings`) without knowing which
 * workspace the reader works in. `/$orgSlug`'s guard sees the placeholder and
 * resolves it: straight into the reader's only workspace, or on to
 * `/choose-organization` when they have more than one. Signed out, the same
 * link goes through `/login` first and comes back to the guard unchanged.
 *
 * Neither placeholder can be a real slug: `slugify` keeps only `[a-z0-9-]`,
 * and `enterOrganization` checks for a placeholder before it looks a slug up.
 */
const ORG_PLACEHOLDERS = new Set([":org", "_"]);

export const isOrgPlaceholder = (slug: string) => ORG_PLACEHOLDERS.has(slug);

/**
 * `value` when it is a same-site absolute path, otherwise null. A redirect
 * target rides in a link and is attacker-supplied in principle. "//evil.com"
 * is a protocol-relative URL, not a path, and browsers read "/\evil.com" the
 * same way, which is why the two extra tests are not redundant.
 */
export const safeRedirectPath = (value: string | null | undefined) =>
	value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
		? value
		: null;

/** `href` with its first path segment — the org slug — replaced by `slug`.
 *  "/" becomes the workspace's home. */
export const withOrgSlug = (href: string, slug: string) =>
	href.replace(/^\/[^/?#]*/, `/${encodeURIComponent(slug)}`);

/** The first path segment of `href`, decoded — the slug it names. */
export const orgSlugOf = (href: string) => {
	const segment = /^\/([^/?#]*)/.exec(href)?.[1] ?? "";
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
};
