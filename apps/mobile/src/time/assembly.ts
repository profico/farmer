import type {
	ApplyDayAssembly,
	DayAssemblyResult,
	DaySuggestion,
} from "@farmer/api-client";

/**
 * "Assemble my day": the words of each suggestion, and the body that makes
 * the chosen ones into entries. The same rules as the dialog of the web app
 * (`assemble-day-dialog.tsx`).
 */

/** Where a chosen suggestion goes: the proposal, or what the person picked. */
export type AssemblyPick = { projectId: string | null; taskId: string };

export const suggestionTitle = (s: DaySuggestion): string => {
	switch (s.kind) {
		case "meeting":
			return s.description || "Meeting";
		case "work":
			return s.projectName ?? s.taskName;
		case "review":
			return s.description;
		case "break":
			return "Break";
		default:
			return "Work, rest of the day";
	}
};

const count = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;

/** Where the suggestion came from, so the person can trust it or not. */
export const suggestionSource = (s: DaySuggestion): string => {
	switch (s.kind) {
		case "meeting":
			return "From your calendar";
		case "work": {
			// One repository only when every commit and pull request agree.
			const repos = new Set([
				...s.commits.map((c) => c.repoFullName),
				...s.pullRequests.map((p) => p.repoFullName),
			]);
			const [repo] = repos;
			const where = repos.size === 1 && repo ? ` in ${repo}` : "";
			const parts = [
				s.commits.length > 0
					? count(s.commits.length, "commit", "commits")
					: null,
				s.pullRequests.length > 0
					? count(s.pullRequests.length, "pull request", "pull requests")
					: null,
			].filter((part) => part !== null);
			return `From ${parts.join(" and ")}${where}`;
		}
		case "review": {
			const [pr] = s.pullRequests;
			// A review has no length on GitHub, so the time is an estimate.
			return pr
				? `From your review of #${pr.number} in ${pr.repoFullName}, estimated`
				: "From your pull request reviews, estimated";
		}
		case "break":
			return "From your recurring blocks";
		default:
			return "Assumed from your working hours";
	}
};

/** The suggestions that start ticked: all but the ones deleted before. */
export const defaultSelection = (suggestions: readonly DaySuggestion[]) =>
	new Set(suggestions.filter((s) => !s.dismissed).map((s) => s.key));

/** The body of `applyDayAssembly` for the chosen suggestions. */
export const applyBody = (
	date: string,
	chosen: readonly DaySuggestion[],
	pickFor: (s: DaySuggestion) => AssemblyPick,
): ApplyDayAssembly => ({
	date,
	entries: chosen.map((s) => {
		const pick = pickFor(s);
		return {
			taskId: pick.taskId,
			projectId: pick.projectId ?? undefined,
			description: s.description || undefined,
			// The server sizes a rest-of-day block from the day.
			durationSeconds: s.fillsDay ? undefined : s.durationSeconds,
			fillsDay: s.fillsDay || undefined,
			meetingUrl: s.meetingUrl ?? undefined,
			calendarEventId: s.calendarEventId ?? undefined,
			commits:
				s.commits.length > 0
					? s.commits.map((c) => ({
							projectGithubRepoId: c.projectGithubRepoId,
							sha: c.sha,
						}))
					: undefined,
			pullRequests:
				s.pullRequests.length > 0
					? s.pullRequests.map((p) => ({
							projectGithubRepoId: p.projectGithubRepoId,
							number: p.number,
						}))
					: undefined,
		};
	}),
});

/** What the apply did, as one sentence. */
export const assemblyMessage = ({ created, errors }: DayAssemblyResult) => {
	const added = `Added ${count(created, "block", "blocks")}`;
	if (errors.length === 0) return { message: `${added}.`, warning: false };
	return {
		message: `${added}, ${errors.length} failed: ${errors[0]}`,
		warning: true,
	};
};

/** The note under the list about the sources that are not connected. */
export const missingSources = (sources: {
	calendar: string;
	github: string;
}): string[] => [
	...(sources.calendar === "unavailable" ? ["Google Calendar"] : []),
	...(sources.github === "unavailable" ? ["GitHub"] : []),
];
