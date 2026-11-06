/**
 * The links into the repository this deployment is built from.
 *
 * `repository` is `owner/name`, from `getPublicAppConfig().repository`, which
 * follows `CLI_RELEASES_REPO` (`@farmer/core/lib/source-repository`), so a
 * fork's "Report a problem" opens an issue on the fork, not on upstream.
 */
export const githubLinks = (repository: string) => {
	const home = `https://github.com/${repository}`;
	return {
		home,
		/** Where somebody reports a problem or suggests something, from inside
		 *  the app. */
		newIssue: `${home}/issues/new`,
		license: `${home}/blob/main/LICENSE`,
		/** The self-hosting docs: the README's install section and `docs/`. */
		docs: `${home}#readme`,
		/** Install, upgrade and backup. */
		selfHosting: `${home}/blob/main/docs/self-hosting.md`,
	};
};

/**
 * What this project is, in one line, for the one place anybody asks: the
 * contributors popover at the foot of Settings.
 *
 * It lives here beside the repository URL because the two are read together and
 * for the same reason — somebody has just wondered what they are looking at.
 */
export const PROJECT_TAGLINE =
	"Help us fix stuff, open a PR, validate a bug. You know you want your face in this list.";

/** The licence the code is under, as the API page footer names it. */
export const LICENSE_NAME = "AGPLv3";
