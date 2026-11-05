import type {
	AttachCommits,
	AttachPullRequests,
	AttachedCommit,
	CommitSuggestion,
	PullRequestSuggestion,
} from "@farmer/api-client";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import {
	useAttachedCommits,
	useAttachedPullRequests,
	useDetachCommit,
	useDetachPullRequest,
	useProjectRepositories,
	useSuggestedCommits,
	useSuggestedPullRequests,
} from "../../api/day";
import { useIntegrations } from "../../api/you";
import {
	ActionButton,
	ErrorBanner,
	IconButton,
	Skeleton,
	Text,
} from "../../ui/components";
import { messageOf } from "../../ui/errors";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import {
	activityDescription,
	activitySummary,
	commitKey,
	groupAttachedPullRequests,
	nextNote,
	type PullRequestGroup,
	pullRequestKey,
	shortSha,
	subjectOf,
} from "../github";
import { CheckRow } from "./check-row";

const open = (url: string) => {
	void WebBrowser.openBrowserAsync(url).catch(() => undefined);
};

/** The commits and pull requests that Save attaches. */
export type ActivityPicks = {
	commits: AttachCommits["commits"];
	pullRequests: AttachPullRequests["pullRequests"];
};

/** The ticks, kept with the project and day they were made for. Another
 *  project or day starts with none: its activity is evidence of other
 *  work. */
type Ticks = {
	scope: string;
	commits: ReadonlySet<string>;
	pullRequests: ReadonlySet<string>;
};

/**
 * GitHub on an entry, as the entry dialog of the web app has it. The
 * commits and pull requests already attached show whenever there are some.
 * The picker shows for an entry on a project with a linked repository, when
 * the person has GitHub connected, and not for a rest-of-day block or a
 * repeat. With "auto-load commits" on, the day's activity loads at once;
 * else it loads when the person asks.
 */
export function useEntryGithub({
	entryId,
	projectId,
	date,
	repeats,
	fill,
	note,
	setNote,
}: {
	entryId: string | null;
	/** Null for no project and for time off. */
	projectId: string | null;
	date: string;
	repeats: boolean;
	fill: boolean;
	note: string;
	setNote: (note: string) => void;
}) {
	const integrations = useIntegrations();
	const connected = integrations.data?.github.connected === true;
	const autoLoad = integrations.data?.settings.githubAutoLoadCommits === true;
	const canPick = connected && !repeats && !fill && projectId !== null;
	const repos = useProjectRepositories(projectId, canPick);
	const showPicker = canPick && (repos.data?.length ?? 0) > 0;

	const attachedCommits = useAttachedCommits(entryId);
	const attachedPullRequests = useAttachedPullRequests(entryId);
	const commitsOn = repeats ? [] : (attachedCommits.data ?? []);
	const groups = repeats
		? []
		: groupAttachedPullRequests(attachedPullRequests.data ?? []);

	const scope = `${projectId ?? ""}:${date}`;
	const [asked, setAsked] = useState<string | null>(null);
	const load = showPicker && (autoLoad || asked === scope);
	const suggestedCommits = useSuggestedCommits(projectId, date, load);
	const suggestedPullRequests = useSuggestedPullRequests(projectId, date, load);
	const attachedShas = new Set(commitsOn.map((c) => c.sha));
	const attachedUrls = new Set(groups.map((g) => g.pullRequestUrl));
	const pickableCommits = load
		? (suggestedCommits.data ?? []).filter((c) => !attachedShas.has(c.sha))
		: [];
	const pickablePullRequests = load
		? (suggestedPullRequests.data ?? []).filter(
				(pr) => !attachedUrls.has(pr.url),
			)
		: [];

	const [ticks, setTicks] = useState<Ticks | null>(null);
	const current: Ticks =
		ticks && ticks.scope === scope
			? ticks
			: { scope, commits: new Set(), pullRequests: new Set() };
	const chosenCommits = pickableCommits.filter((c) =>
		current.commits.has(commitKey(c)),
	);
	const chosenPullRequests = pickablePullRequests.filter((pr) =>
		current.pullRequests.has(pullRequestKey(pr)),
	);

	// The note that the last tick wrote. Once the person types over it, the
	// note is theirs and the ticks leave it alone.
	const written = useRef<string | null>(null);
	const retick = (next: Ticks) => {
		setTicks(next);
		const text = activityDescription(
			pickableCommits.filter((c) => next.commits.has(commitKey(c))),
			pickablePullRequests.filter((pr) =>
				next.pullRequests.has(pullRequestKey(pr)),
			),
		);
		const after = nextNote(note, written.current, text);
		if (after === null) return;
		written.current = after;
		if (after !== note) setNote(after);
	};
	const flip = (set: ReadonlySet<string>, key: string) => {
		const next = new Set(set);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	};

	const detachCommit = useDetachCommit(entryId ?? "");
	const detachPullRequest = useDetachPullRequest(entryId ?? "");

	/** What Save attaches to the saved entry. */
	const picks = () =>
		repeats
			? ({ commits: [], pullRequests: [] } satisfies ActivityPicks)
			: ({
					commits: chosenCommits.map((c) => ({
						projectGithubRepoId: c.projectGithubRepoId,
						sha: c.sha,
					})),
					pullRequests: chosenPullRequests.map((pr) => ({
						projectGithubRepoId: pr.projectGithubRepoId,
						number: pr.number,
					})),
				} satisfies ActivityPicks);

	return {
		showPicker,
		autoLoad,
		/** The activity was asked for, or loads on its own. */
		loaded: load,
		ask: () => setAsked(scope),
		refresh: () => {
			void suggestedCommits.refetch();
			void suggestedPullRequests.refetch();
		},
		finding: suggestedCommits.isFetching || suggestedPullRequests.isFetching,
		commitsFound: suggestedCommits.isSuccess,
		pullRequestsFound: suggestedPullRequests.isSuccess,
		findError: suggestedCommits.error ?? suggestedPullRequests.error,
		attachedCommits: commitsOn,
		attachedGroups: groups,
		pickableCommits,
		pickablePullRequests,
		ticks: current,
		toggleCommit: (c: CommitSuggestion) =>
			retick({ ...current, commits: flip(current.commits, commitKey(c)) }),
		togglePullRequest: (pr: PullRequestSuggestion) =>
			retick({
				...current,
				pullRequests: flip(current.pullRequests, pullRequestKey(pr)),
			}),
		detachCommit,
		detachPullRequest,
		/** Commits and pull requests happened on the entry's day, so an
		 *  entry that holds some stays on that day. */
		dayLocked:
			entryId !== null &&
			((attachedCommits.data?.length ?? 0) > 0 ||
				(attachedPullRequests.data?.length ?? 0) > 0),
		picks,
	};
}

export type EntryGithub = ReturnType<typeof useEntryGithub>;

/** The GitHub part of the entry sheet. */
export function EntryGithubSection({ github }: { github: EntryGithub }) {
	const palette = usePalette();
	const [opened, setOpened] = useState(false);
	const hasAttached =
		github.attachedCommits.length > 0 || github.attachedGroups.length > 0;
	if (!github.showPicker && !hasAttached) return null;

	const pullIn = () => {
		setOpened(!opened);
		if (!github.autoLoad) github.ask();
	};
	if (!opened && !hasAttached) {
		return (
			<View style={{ flexDirection: "row" }}>
				<ActionButton
					label="Pull in GitHub activity"
					variant="text"
					onPress={pullIn}
				/>
			</View>
		);
	}

	const detachError =
		github.detachCommit.error ?? github.detachPullRequest.error;
	const busy =
		github.detachCommit.isPending || github.detachPullRequest.isPending;
	const showCommits = github.showPicker || github.attachedCommits.length > 0;
	const showPullRequests =
		github.showPicker || github.attachedGroups.length > 0;

	return (
		<View style={{ gap: SPACE.s }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<Text variant="labelLarge" color={palette.onSurfaceVariant}>
					GitHub activity
				</Text>
				{!github.showPicker ? null : github.loaded ? (
					<ActionButton
						label={github.finding ? "Loading" : "Refresh"}
						variant="text"
						onPress={github.refresh}
						disabled={github.finding}
					/>
				) : (
					<ActionButton
						label="Find activity"
						variant="text"
						onPress={github.ask}
					/>
				)}
			</View>
			{detachError ? (
				<ErrorBanner message={messageOf(detachError) ?? ""} />
			) : null}
			{github.findError ? (
				<ErrorBanner message={messageOf(github.findError) ?? ""} />
			) : null}
			<View
				style={{
					borderRadius: 16,
					overflow: "hidden",
					backgroundColor: palette.surfaceContainer,
				}}
			>
				{showCommits ? (
					<>
						<SubHeader label="Commits" first />
						{github.attachedCommits.map((commit) => (
							<AttachedCommitRow
								key={commit.id}
								commit={commit}
								disabled={busy}
								onDetach={() => github.detachCommit.mutate(commit.id)}
							/>
						))}
						{github.pickableCommits.map((commit) => (
							<Row key={commitKey(commit)}>
								<CheckRow
									checked={github.ticks.commits.has(commitKey(commit))}
									onPress={() => github.toggleCommit(commit)}
									label={`${subjectOf(commit.message)}, ${commit.repoFullName}`}
								>
									<Text variant="bodyMedium" numberOfLines={2}>
										{subjectOf(commit.message)}
									</Text>
									<Text
										variant="bodySmall"
										color={palette.onSurfaceVariant}
										numberOfLines={1}
									>
										{commit.repoFullName} · {shortSha(commit.sha)}
									</Text>
								</CheckRow>
							</Row>
						))}
						{github.loaded && github.finding && !github.commitsFound ? (
							<Pad>
								<Skeleton height={40} />
							</Pad>
						) : null}
						{github.loaded &&
						github.commitsFound &&
						github.pickableCommits.length === 0 ? (
							<Note>No commits found for this day.</Note>
						) : null}
					</>
				) : null}
				{showPullRequests ? (
					<>
						<SubHeader label="Pull requests" first={!showCommits} />
						{github.attachedGroups.map((group) => (
							<AttachedPullRequestRow
								key={group.pullRequestUrl}
								group={group}
								disabled={busy}
								onDetach={() => github.detachPullRequest.mutate(group.ids)}
							/>
						))}
						{github.pickablePullRequests.map((pr) => (
							<Row key={pullRequestKey(pr)}>
								<CheckRow
									checked={github.ticks.pullRequests.has(pullRequestKey(pr))}
									onPress={() => github.togglePullRequest(pr)}
									label={`${pr.title}, ${pr.repoFullName} #${pr.number}`}
								>
									<Text variant="bodyMedium" numberOfLines={2}>
										{pr.title}
									</Text>
									<Text
										variant="bodySmall"
										color={palette.onSurfaceVariant}
										numberOfLines={1}
									>
										{pr.repoFullName} #{pr.number} ·{" "}
										{activitySummary(pr.activity)}
									</Text>
								</CheckRow>
							</Row>
						))}
						{github.loaded &&
						github.pullRequestsFound &&
						github.pickablePullRequests.length === 0 ? (
							<Note>No pull requests found for this day.</Note>
						) : null}
					</>
				) : null}
			</View>
		</View>
	);
}

function SubHeader({ label, first }: { label: string; first?: boolean }) {
	const palette = usePalette();
	return (
		<View
			style={{
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.s,
				borderTopWidth: first ? 0 : 1,
				borderTopColor: palette.outlineVariant,
			}}
		>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
		</View>
	);
}

function Row({ children }: { children: ReactNode }) {
	const palette = usePalette();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				borderTopWidth: 1,
				borderTopColor: palette.outlineVariant,
			}}
		>
			{children}
		</View>
	);
}

function Pad({ children }: { children: ReactNode }) {
	return <View style={{ padding: SPACE.l }}>{children}</View>;
}

function Note({ children }: { children: string }) {
	const palette = usePalette();
	return (
		<View
			style={{
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.m,
				borderTopWidth: 1,
				borderTopColor: palette.outlineVariant,
			}}
		>
			<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
				{children}
			</Text>
		</View>
	);
}

/** An attached thing: its link, its words, and a button to remove it. */
function AttachedRow({
	link,
	linkLabel,
	title,
	detail,
	removeLabel,
	disabled,
	onDetach,
}: {
	link: string;
	linkLabel: string;
	title: string;
	detail?: string;
	removeLabel: string;
	disabled: boolean;
	onDetach: () => void;
}) {
	const palette = usePalette();
	return (
		<Row>
			<Pressable
				accessibilityRole="link"
				accessibilityLabel={`${linkLabel}, ${title}`}
				accessibilityHint="Opens it on GitHub"
				onPress={() => open(link)}
				android_ripple={{ color: palette.outlineVariant }}
				style={{
					flex: 1,
					paddingLeft: SPACE.l,
					paddingVertical: SPACE.m,
					gap: 2,
				}}
			>
				<Text variant="bodyMedium" numberOfLines={2}>
					{title}
				</Text>
				<Text variant="bodySmall" color={palette.primary} numberOfLines={1}>
					{detail ? `${linkLabel} · ${detail}` : linkLabel}
				</Text>
			</Pressable>
			<IconButton
				icon="close"
				label={removeLabel}
				onPress={onDetach}
				disabled={disabled}
			/>
		</Row>
	);
}

function AttachedCommitRow({
	commit,
	disabled,
	onDetach,
}: {
	commit: AttachedCommit;
	disabled: boolean;
	onDetach: () => void;
}) {
	return (
		<AttachedRow
			link={commit.url}
			linkLabel={shortSha(commit.sha)}
			title={subjectOf(commit.message)}
			detail={commit.repoFullName ?? undefined}
			removeLabel={`Remove commit ${shortSha(commit.sha)}`}
			disabled={disabled}
			onDetach={onDetach}
		/>
	);
}

function AttachedPullRequestRow({
	group,
	disabled,
	onDetach,
}: {
	group: PullRequestGroup;
	disabled: boolean;
	onDetach: () => void;
}) {
	return (
		<AttachedRow
			link={group.pullRequestUrl}
			linkLabel={`#${group.number}`}
			title={group.title}
			detail={activitySummary(group.events)}
			removeLabel={`Remove pull request #${group.number}`}
			disabled={disabled}
			onDetach={onDetach}
		/>
	);
}
