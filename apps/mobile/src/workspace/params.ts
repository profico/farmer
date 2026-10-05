/**
 * One value of a route parameter. Expo Router gives a list when the same
 * name is in the address more than one time; the first value is used then.
 */
export const paramOf = (
	value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

/** A whole number from a route parameter, or `fallback`. */
export const intParamOf = (
	value: string | string[] | undefined,
	fallback: number,
): number => {
	const parsed = Number.parseInt(paramOf(value) ?? "", 10);
	return Number.isFinite(parsed) ? parsed : fallback;
};
