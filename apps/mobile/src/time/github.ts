import type {
	AttachedPullRequest,
	CommitSuggestion,
	PullRequestSuggestion,
} from "@farmer/api-client";

/**
 * GitHub on an entry: the keys of the picks, the words for pull request
 * activity, and the note that ticked activity writes. The same rules as the
 * entry dialog of the web app (`add-block-dialog.tsx`) and the commit engine
 * (`summarizeCommitMessages`, `describePullRequestActivity` in
 * `@farmer/core`). The app does not depend on `@farmer/core`, so the rules
 * are copied here.
 */

/** The server refuses a longer note. */
const DESCRIPTION_MAX_CHARS = 10_000;

export const commitKey = (c: { projectGithubRepoId: string; sha: string }) =>
	`${c.projectGithubRepoId}:${c.sha}`;

export const pullRequestKey = (p: {
	projectGithubRepoId: string;
	number: number;
}) => `${p.projectGithubRepoId}:${p.number}`;

/** The first line of a commit message. */
export const subjectOf = (message: string) => message.split("\n")[0] ?? "";

export const shortSha = (sha: string) => sha.slice(0, 7);

/** One act on a pull request, as a label. */
const activityLabel = (kind: string, reviewState: string | null) => {
	switch (kind) {
		case "opened":
			return "Opened";
		case "merged":
			return "Merged";
		case "closed":
			return "Closed";
		default:
			break;
	}
	switch (reviewState) {
		case "approved":
			return "Reviewed (approved)";
		case "changes_requested":
			return "Reviewed (changes requested)";
		case "commented":
			return "Reviewed (commented)";
		case "dismissed":
			return "Reviewed (dismissed)";
		default:
			return "Reviewed";
	}
};

/** The different labels of some acts, in the order they first came. */
export const activitySummary = (
	events: readonly { kind: string; reviewState: string | null }[],
) =>
	[...new Set(events.map((e) => activityLabel(e.kind, e.reviewState)))].join(
		" · ",
	);

export type PullRequestGroup = {
	pullRequestUrl: string;
	number: number;
	title: string;
	/** Every attachment of the pull request, to remove them together. */
	ids: string[];
	events: { kind: string; reviewState: string | null }[];
};

/** The attached events, one group for each pull request. */
export const groupAttachedPullRequests = (
	rows: readonly AttachedPullRequest[],
): PullRequestGroup[] => {
	const groups = new Map<string, PullRequestGroup>();
	for (const row of rows) {
		const event = { kind: row.kind, reviewState: row.reviewState };
		const group = groups.get(row.pullRequestUrl);
		if (group) {
			group.ids.push(row.id);
			group.events.push(event);
		} else {
			groups.set(row.pullRequestUrl, {
				pullRequestUrl: row.pullRequestUrl,
				number: row.number,
				title: row.title,
				ids: [row.id],
				events: [event],
			});
		}
	}
	return [...groups.values()];
};

/** The commit subjects, whole, until the note is full. */
export const summarizeCommitMessages = (messages: readonly string[]) => {
	let summary = "";
	for (const message of messages) {
		const line = subjectOf(message).trim();
		if (!line) continue;
		const next = summary ? `${summary}; ${line}` : line;
		if (next.length > DESCRIPTION_MAX_CHARS) break;
		summary = next;
	}
	return summary;
};

const verbOf = (kind: string) => {
	switch (kind) {
		case "opened":
			return "Opened";
		case "merged":
			return "Merged";
		case "closed":
			return "Closed";
		case "reviewed":
			return "Reviewed";
		default:
			return "Worked on";
	}
};

/** One line for each different act on a pull request. */
const describePullRequestActivity = (
	activity: readonly { kind: string; number: number; title: string }[],
) => [
	...new Set(activity.map((a) => `${verbOf(a.kind)} #${a.number}: ${a.title}`)),
];

/** The note that the ticked commits and pull requests write. */
export const activityDescription = (
	commits: readonly CommitSuggestion[],
	pullRequests: readonly PullRequestSuggestion[],
) =>
	summarizeCommitMessages([
		...commits.map((c) => c.message),
		...describePullRequestActivity(
			pullRequests.flatMap((pr) =>
				pr.activity.map((a) => ({
					kind: a.kind,
					number: pr.number,
					title: pr.title,
				})),
			),
		),
	]);

/**
 * The note after a tick. The ticks write the note only while it is empty
 * or still holds what the last tick wrote: after the person types, the
 * note is theirs.
 */
export const nextNote = (
	current: string,
	lastWritten: string | null,
	written: string,
): string | null =>
	current.trim() && current !== lastWritten ? null : written;
