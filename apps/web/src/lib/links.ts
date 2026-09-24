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
		releases: `${home}/releases`,
		license: `${home}/blob/main/LICENSE`,
		/** The self-hosting docs: the README's install section and `docs/`. */
		docs: `${home}#readme`,
		deployment: `${home}/blob/main/docs/domains/deployment.md`,
		compose: `${home}/blob/main/docker-compose.yml`,
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

/** The licence the code is under, as the public site names it. */
export const LICENSE_NAME = "AGPLv3";

/** Where the public site sends "Talk to us". */
export const CONTACT_EMAIL = "farmer@profi.co";

/**
 * The hosted early-access sign-up. A Google Form rather than a table of our
 * own: the list is Profico's, not the instance's, and nobody has to run it.
 * Set it to "" and the early-access page falls back to `CONTACT_EMAIL`.
 */
export const EARLY_ACCESS_FORM_URL =
	"https://docs.google.com/forms/d/e/1FAIpQLSdtMKedZUzdy-jyoXNnzMkrUUA8_T84c4d-fgynrcNnCg1kMQ/viewform?usp=header";
