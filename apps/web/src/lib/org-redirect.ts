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

const REDIRECT_BASE = "http://farmer.invalid";

/**
 * `value` when it is a same-site absolute path, otherwise null. A redirect
 * target rides in a link and is attacker-supplied in principle, so it is
 * resolved the way a browser would and its origin compared, not matched by
 * prefix. A prefix test misses what the parser does first: "//evil.com" and
 * "/\evil.com" are protocol-relative, and the parser strips tab, CR and LF,
 * so "/\t/evil.com" is too. An unparsable value is not a path either.
 */
export const safeRedirectPath = (value: string | null | undefined) => {
	if (!value?.startsWith("/")) return null;
	try {
		return new URL(value, REDIRECT_BASE).origin === REDIRECT_BASE
			? value
			: null;
	} catch {
		return null;
	}
};

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
