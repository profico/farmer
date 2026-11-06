// A Harvest import in multi-organization mode must not write a real address
// into the global `user` table: the address may belong to a person who has
// not signed up, and an unverified row for it blocks their sign-in (issue
// #162). The import makes a placeholder user with an address that cannot
// receive mail or match a sign-in. The real address lives in
// `import_pending_person` until the person claims the history.

/** The reserved top-level domain `.invalid` (RFC 2606) never resolves. */
const PLACEHOLDER_SUFFIX = "@import.invalid";

export const placeholderEmail = (userId: string): string =>
	`import-${userId}${PLACEHOLDER_SUFFIX}`;

export const isPlaceholderEmail = (email: string): boolean =>
	email.toLowerCase().endsWith(PLACEHOLDER_SUFFIX);
