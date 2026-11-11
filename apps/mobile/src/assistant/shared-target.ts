const stripSlashes = (value: string) => value.replace(/\/+$/, "");

// A malformed link must not throw: show the raw text.
const hostOf = (url: string) => {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
};

/** Why a deep link points at another workspace, or null when it matches. */
export function otherWorkspace(
	link: { org?: string; server?: string },
	current: { origin: string; slug: string },
): { server: string; org: string } | null {
	const server = link.server ? stripSlashes(link.server) : undefined;
	const sameServer = !server || server === stripSlashes(current.origin);
	const sameOrg = !link.org || link.org === current.slug;
	if (sameServer && sameOrg) return null;
	return {
		server: hostOf(server ?? current.origin),
		org: link.org ?? current.slug,
	};
}
