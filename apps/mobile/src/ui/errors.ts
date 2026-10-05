/** The sentence for a failed call, for a banner. */
export const messageOf = (error: Error | null) =>
	error ? error.message || "Something went wrong. Try again." : null;
