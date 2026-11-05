const parts = (version: string): [number, number, number] | null => {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
	if (!match) return null;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/**
 * Whether `version` is at least `minimum`, as `major.minor.patch`. The same
 * rule as the server's `isCliVersionSupported`: a pre-release suffix is
 * ignored, and a version that does not parse is refused.
 */
export const isVersionAtLeast = (version: string, minimum: string) => {
	const have = parts(version);
	const need = parts(minimum);
	if (!have || !need) return false;
	for (let i = 0; i < 3; i++) {
		const a = have[i] ?? 0;
		const b = need[i] ?? 0;
		if (a !== b) return a > b;
	}
	return true;
};
