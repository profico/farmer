import { timeKeyInTz } from "@farmer/core/lib/time";
import {
	CalendarDotIcon,
	GitCommitIcon,
	VideoCameraIcon,
	XIcon,
} from "@phosphor-icons/react";

import { Button } from "#/components/ui/button.tsx";
import { cn } from "#/lib/utils.ts";
import type {
	listAttachedCommits,
	listAttachedPullRequests,
} from "#/server/github.ts";

import {
	activitySummary,
	type AttachedPullRequestGroup,
	type CalendarEvent,
	commitKey,
	pullRequestKey,
	type SuggestedCommit,
	type SuggestedPullRequest,
} from "./add-block-form.ts";

type AttachedCommit = Awaited<ReturnType<typeof listAttachedCommits>>[number];
export type AttachedPullRequest = Awaited<
	ReturnType<typeof listAttachedPullRequests>
>[number];

function CalendarEventRow({
	event,
	selected,
	timezone,
	onPick,
}: {
	event: CalendarEvent;
	selected: boolean;
	timezone: string;
	onPick: (event: CalendarEvent) => void;
}) {
	return (
		<button
			type="button"
			onClick={() => onPick(event)}
			className={cn(
				"flex w-full items-start gap-2 border-b border-line2 px-3 py-2 text-left last:border-b-0 hover:bg-muted",
				selected && "bg-muted",
			)}
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm">{event.title}</span>
				<span className="text-xs text-muted-foreground">
					{timeKeyInTz(new Date(event.start), timezone)}–
					{timeKeyInTz(new Date(event.end), timezone)}
					{event.meetingUrl ? " · has link" : ""}
				</span>
			</span>
			{event.meetingUrl && (
				<VideoCameraIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
			)}
		</button>
	);
}

export function CalendarEventList({
	events,
	isFetching,
	isError,
	isSuccess,
	selectedEventId,
	timezone,
	onPick,
}: {
	events: CalendarEvent[];
	isFetching: boolean;
	isError: boolean;
	isSuccess: boolean;
	selectedEventId: string | null;
	timezone: string;
	onPick: (event: CalendarEvent) => void;
}) {
	return (
		<div className="rounded-lg border border-line2">
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-sm font-medium">Google Calendar</span>
				{isFetching && (
					<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<CalendarDotIcon className="pulse-quiet size-3.5" />
						Loading…
					</span>
				)}
			</div>
			{events.length > 0 && (
				<div className="scrollbar-stable max-h-52 overflow-y-auto border-t border-line2">
					{events.map((event) => (
						<CalendarEventRow
							key={event.id}
							event={event}
							selected={selectedEventId === event.id}
							timezone={timezone}
							onPick={onPick}
						/>
					))}
				</div>
			)}
			{isError && (
				<p className="border-t border-line2 px-3 py-2 text-sm text-destructive">
					Could not load your calendar. Try reconnecting Google.
				</p>
			)}
			{isSuccess && events.length === 0 && (
				<p className="border-t border-line2 px-3 py-2 text-sm text-muted-foreground">
					No meetings found for this day.
				</p>
			)}
		</div>
	);
}

export function MeetingLink({ url }: { url: string }) {
	return (
		<p className="-mt-2 truncate text-sm text-muted-foreground">
			Meeting link:{" "}
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="underlined text-primary"
			>
				{url}
			</a>
		</p>
	);
}

function AttachedCommitList({
	commits,
	pending,
	onDetach,
}: {
	commits: AttachedCommit[];
	pending: boolean;
	onDetach: (id: string) => void;
}) {
	return (
		<div className="scrollbar-stable max-h-40 overflow-y-auto border-t border-line2">
			{commits.map((commit) => (
				<div
					key={commit.id}
					className="flex items-center justify-between gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
				>
					{/* The sha is the link, not the whole row: the row is also a click
					    target for nothing else, and making the message a link would put
					    an underline through a subject that is often the entry's own
					    description. `url` has always been stored on the attachment; it
					    simply had nothing rendering it. */}
					<span className="flex min-w-0 items-baseline gap-1.5 text-sm">
						<a
							href={commit.url}
							target="_blank"
							rel="noreferrer"
							className="mono shrink-0 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
							title={commit.repo?.fullName ?? undefined}
						>
							{commit.sha.slice(0, 7)}
						</a>
						<span className="min-w-0 truncate">
							{commit.message.split("\n")[0]}
						</span>
					</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="shrink-0 hover:text-destructive"
						onClick={() => onDetach(commit.id)}
						disabled={pending}
					>
						<XIcon weight="regular" className="size-3" />
						<span className="sr-only">Remove</span>
					</Button>
				</div>
			))}
		</div>
	);
}

function CommitPickerList({
	commits,
	selectedKeys,
	onToggle,
}: {
	commits: SuggestedCommit[];
	selectedKeys: Set<string>;
	onToggle: (key: string) => void;
}) {
	return (
		<div className="scrollbar-stable max-h-52 overflow-y-auto border-t border-line2">
			{commits.map((commit) => {
				const key = commitKey(commit.projectGithubRepoId, commit.sha);
				return (
					<label
						key={key}
						className="flex cursor-pointer items-start gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
					>
						<input
							type="checkbox"
							className="mt-0.5 accent-primary"
							checked={selectedKeys.has(key)}
							onChange={() => onToggle(key)}
						/>
						<span className="min-w-0 flex-1 text-sm">
							<span className="block truncate">
								{commit.message.split("\n")[0]}
							</span>
							<span className="block truncate text-xs text-muted-foreground">
								{commit.repoFullName} · {commit.sha.slice(0, 7)}
							</span>
						</span>
					</label>
				);
			})}
		</div>
	);
}

function AttachedPullRequestList({
	groups,
	pending,
	onDetach,
}: {
	groups: AttachedPullRequestGroup[];
	pending: boolean;
	onDetach: (ids: string[]) => void;
}) {
	return (
		<div className="scrollbar-stable max-h-40 overflow-y-auto border-t border-line2">
			{groups.map((group) => (
				<div
					key={group.pullRequestUrl}
					className="flex items-center justify-between gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
				>
					<span className="flex min-w-0 items-baseline gap-1.5 text-sm">
						<a
							href={group.pullRequestUrl}
							target="_blank"
							rel="noreferrer"
							className="mono shrink-0 text-xs text-muted-foreground underline underline-offset-3 hover:text-foreground"
						>
							#{group.number}
						</a>
						<span className="min-w-0 truncate">{group.title}</span>
					</span>
					<span className="flex shrink-0 items-center gap-2">
						<span className="hidden text-xs text-muted-foreground sm:inline">
							{activitySummary(group.events)}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="hover:text-destructive"
							onClick={() => onDetach(group.ids)}
							disabled={pending}
						>
							<XIcon weight="regular" className="size-3" />
							<span className="sr-only">Remove</span>
						</Button>
					</span>
				</div>
			))}
		</div>
	);
}

function PullRequestPickerList({
	pullRequests,
	selectedKeys,
	onToggle,
}: {
	pullRequests: SuggestedPullRequest[];
	selectedKeys: Set<string>;
	onToggle: (key: string) => void;
}) {
	return (
		<div className="scrollbar-stable max-h-52 overflow-y-auto border-t border-line2">
			{pullRequests.map((pr) => {
				const key = pullRequestKey(pr.projectGithubRepoId, pr.number);
				return (
					<label
						key={key}
						className="flex cursor-pointer items-start gap-2 border-b border-line2 px-3 py-2 last:border-b-0"
					>
						<input
							type="checkbox"
							className="mt-0.5 accent-primary"
							checked={selectedKeys.has(key)}
							onChange={() => onToggle(key)}
						/>
						<span className="min-w-0 flex-1 text-sm">
							<span className="block truncate">{pr.title}</span>
							<span className="block truncate text-xs text-muted-foreground">
								{pr.repoFullName} #{pr.number} · {activitySummary(pr.activity)}
							</span>
						</span>
					</label>
				);
			})}
		</div>
	);
}

function EmptyNote({ children }: { children: string }) {
	return (
		<p className="border-t border-line2 px-3 py-2 text-sm text-muted-foreground">
			{children}
		</p>
	);
}

function SectionTitle({ children }: { children: string }) {
	return (
		<div className="border-t border-line2 px-3 py-1.5 text-2xs font-medium text-muted-foreground">
			{children}
		</div>
	);
}

function ReloadButton({
	autoLoadCommits,
	busy,
	onReload,
}: {
	autoLoadCommits: boolean;
	busy: boolean;
	onReload: () => void;
}) {
	let label = autoLoadCommits ? "Refresh" : "Find activity";
	if (busy) label = autoLoadCommits ? "Loading…" : "Finding…";
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onClick={onReload}
			disabled={busy}
		>
			<GitCommitIcon className="size-3.5" />
			{label}
		</Button>
	);
}

export type CommitSection = {
	show: boolean;
	showAttached: boolean;
	attached: AttachedCommit[] | undefined;
	pickable: SuggestedCommit[];
	selectedKeys: Set<string>;
	loaded: boolean;
	detaching: boolean;
	onToggle: (key: string) => void;
	onDetach: (id: string) => void;
};

export type PullRequestSection = {
	show: boolean;
	showAttached: boolean;
	groups: AttachedPullRequestGroup[];
	pickable: SuggestedPullRequest[];
	selectedKeys: Set<string>;
	loaded: boolean;
	detaching: boolean;
	onToggle: (key: string) => void;
	onDetach: (ids: string[]) => void;
};

function CommitsSection({ section }: { section: CommitSection }) {
	return (
		<div>
			<SectionTitle>Commits</SectionTitle>
			{section.showAttached && (
				<AttachedCommitList
					commits={section.attached ?? []}
					pending={section.detaching}
					onDetach={section.onDetach}
				/>
			)}
			{section.pickable.length > 0 && (
				<CommitPickerList
					commits={section.pickable}
					selectedKeys={section.selectedKeys}
					onToggle={section.onToggle}
				/>
			)}
			{section.loaded && section.pickable.length === 0 && (
				<EmptyNote>No commits found for this day.</EmptyNote>
			)}
		</div>
	);
}

function PullRequestsSection({ section }: { section: PullRequestSection }) {
	return (
		<div>
			<SectionTitle>Pull requests</SectionTitle>
			{section.showAttached && (
				<AttachedPullRequestList
					groups={section.groups}
					pending={section.detaching}
					onDetach={section.onDetach}
				/>
			)}
			{section.pickable.length > 0 && (
				<PullRequestPickerList
					pullRequests={section.pickable}
					selectedKeys={section.selectedKeys}
					onToggle={section.onToggle}
				/>
			)}
			{section.loaded && section.pickable.length === 0 && (
				<EmptyNote>No pull requests found for this day.</EmptyNote>
			)}
		</div>
	);
}

export function GithubActivityPanel({
	showCommitPicker,
	autoLoadCommits,
	busy,
	onReload,
	commits,
	pullRequests,
}: {
	showCommitPicker: boolean;
	autoLoadCommits: boolean;
	busy: boolean;
	onReload: () => void;
	commits: CommitSection;
	pullRequests: PullRequestSection;
}) {
	return (
		<div className="rounded-lg border border-line2">
			<div className="flex min-h-10 items-center justify-between px-3 py-1">
				<span className="text-sm font-medium">GitHub activity</span>
				{showCommitPicker && (
					<ReloadButton
						autoLoadCommits={autoLoadCommits}
						busy={busy}
						onReload={onReload}
					/>
				)}
			</div>
			{(commits.show || commits.showAttached) && (
				<CommitsSection section={commits} />
			)}
			{(pullRequests.show || pullRequests.showAttached) && (
				<PullRequestsSection section={pullRequests} />
			)}
		</div>
	);
}
