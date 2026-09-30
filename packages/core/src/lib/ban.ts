/**
 * Whether the better-auth admin plugin bans a person right now.
 *
 * A ban holds when `banned` is true and `banExpires` is null (no end) or
 * in the future. The plugin stops a banned person at sign-in and removes
 * their sessions. A credential that does not go through sign-in, such as
 * an API token or a stored device-flow session, must ask this function.
 */
export const isBanned = (
	person: { banned?: boolean | null; banExpires?: Date | null },
	now: Date = new Date(),
): boolean =>
	person.banned === true &&
	(person.banExpires == null || person.banExpires > now);
