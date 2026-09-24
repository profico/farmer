import { setting } from "./instance-settings";

/**
 * The GitHub repository this deployment is built from, as `owner/name`.
 *
 * One value serves three readers, because it is one repository: the CLI's
 * binaries are its releases (`/cli/download/<asset>`), the contributors card at
 * the foot of Settings is its contributor list, and the "Report a problem" and
 * "View on GitHub" links point at it. A fork sets `CLI_RELEASES_REPO` (in the
 * environment or on the Infrastructure page) and all three follow.
 *
 * This is the ONE place the upstream name is written. Anything else that needs
 * the repository calls `sourceRepository()`, so a fork never has to hunt for a
 * second copy.
 */
export const DEFAULT_SOURCE_REPOSITORY = "profico/farmer";

/** GitHub's own limits: an owner is 1-39 letters, digits and single hyphens,
 *  not starting with one; a repository name is up to 100 of letters, digits,
 *  `.`, `-` and `_`. Checked rather than trusted because the value goes into
 *  API paths and links, and `owner/../x` must not become a different URL. */
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** Whether `value` is a well-formed `owner/name`. */
export const isRepositoryName = (value: string): boolean => {
	const parts = value.split("/");
	if (parts.length !== 2) return false;
	const [owner = "", name = ""] = parts;
	return OWNER.test(owner) && NAME.test(name) && name !== "." && name !== "..";
};

/**
 * The configured repository, or null when the setting holds something that is
 * not `owner/name`. The caller decides what null means: the download route
 * reports the misconfiguration, a link falls back to upstream.
 */
export const sourceRepository = (): string | null => {
	const value = setting("CLI_RELEASES_REPO") ?? DEFAULT_SOURCE_REPOSITORY;
	return isRepositoryName(value) ? value : null;
};

/** The raw setting, for an error message that has to quote what was set. */
export const configuredSourceRepository = (): string =>
	setting("CLI_RELEASES_REPO") ?? DEFAULT_SOURCE_REPOSITORY;
