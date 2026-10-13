// Where a benchmark run writes its results.
//
// The results hold model output and spend figures. They must never go into
// git by accident, and `.gitignore` here covers only `results/`. So a relative
// `--out` resolves under `results/`, not under the directory the runner was
// started from (that was `packages/core/results/`, which nothing ignores). An
// absolute `--out` inside the repository but outside `results/` is refused.

import { isAbsolute, relative, resolve, sep } from "node:path";

/** True when `path` is `root` or a path under it. */
const inside = (root: string, path: string) => {
	const rel = relative(root, path);
	return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
};

/**
 * The results directory for a run.
 *
 * `here` is this script's directory. `raw` is the `--out` value, empty when
 * it was not given. `today` is the run's date as `YYYY-MM-DD`.
 */
export const resultsDir = (
	here: string,
	raw: string,
	stub: boolean,
	today: string,
): string => {
	const root = resolve(here, "results");
	const out = resolve(root, raw || (stub ? "stub" : today));
	const repo = resolve(here, "..", "..", "..", "..");
	if (inside(repo, out) && !inside(root, out)) {
		throw new Error(
			`--out must be under ${root} or outside the repository, so that git ignores the results.`,
		);
	}
	return out;
};
