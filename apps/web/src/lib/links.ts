export const GITHUB_URL = "https://github.com/profico/farmer";

/** Where somebody reports a problem or suggests something, from inside the app. */
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_URL}/issues/new`;

/** The repository's own contributor graph — the roster popover's way out to
 *  the whole list, rather than the four faces the card has room for. */
export const GITHUB_CONTRIBUTORS_URL = `${GITHUB_URL}/graphs/contributors`;

/**
 * What this project is, in one line, for the one place anybody asks: the
 * contributors popover at the foot of Settings.
 *
 * It lives here beside the repository URL because the two are read together and
 * for the same reason — somebody has just wondered what they are looking at.
 */
export const PROJECT_TAGLINE =
	"Help us fix stuff, open a PR, validate a bug. You know you want your face in this list.";
