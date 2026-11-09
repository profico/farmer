import {
	BrowserIcon,
	DeviceMobileIcon,
	GitCommitIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore, type ReactNode } from "react";
import { z } from "zod";

import { SitePage } from "#/components/site/site-chrome.tsx";

import "#/components/site/changelog.css";
import { githubLinks, REPOSITORY } from "#/lib/links.ts";
import { commitKind } from "#/lib/release-notes.ts";
import { releases, webChanges } from "#/lib/releases.ts";
import type { ReleaseNote, WebCommit } from "#/lib/releases.ts";

const KINDS = ["all", "web", "mobile", "cli"] as const;
type ChangelogKind = (typeof KINDS)[number];

const searchSchema = z.object({
	// Optional, not defaulted: a default is written back into the URL, which
	// turned a plain `/changelog` into a redirect to `?kind=all`.
	kind: z.enum(KINDS).optional().catch(undefined),
});

export const Route = createFileRoute("/changelog")({
	validateSearch: searchSchema,
	head: () => ({ meta: [{ title: "Changelog · Farmer" }] }),
	component: Page,
});

const FILTERS: { kind: ChangelogKind; label: string }[] = [
	{ kind: "all", label: "All" },
	{ kind: "web", label: "Web" },
	{ kind: "mobile", label: "Mobile" },
	{ kind: "cli", label: "CLI" },
];

const TAGS = {
	web: { label: "Web", Icon: BrowserIcon },
	mobile: { label: "Mobile", Icon: DeviceMobileIcon },
	cli: { label: "CLI", Icon: GitCommitIcon },
} as const;

// In UTC: the commit days are UTC calendar days (`groupCommitsByDay`), and
// the server renders in UTC too, so a browser west of UTC must not print the
// day before, or hydrate text that differs from the server's.
const dateFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});

/** The commit day's UTC calendar date, as `committedAt`'s first ten
 *  characters — safe because `committedAt` is a GitHub ISO timestamp
 *  (`…Z`), always UTC. */
const dayOf = (isoTimestamp: string) => isoTimestamp.slice(0, 10);

type DayGroup = { day: string; commits: WebCommit[] };

const groupCommitsByDay = (commits: WebCommit[]): DayGroup[] => {
	const byDay = new Map<string, WebCommit[]>();
	for (const commit of commits) {
		if (!commit.committedAt) continue;
		const day = dayOf(commit.committedAt);
		const group = byDay.get(day);
		if (group) group.push(commit);
		else byDay.set(day, [commit]);
	}
	return [...byDay.entries()]
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([day, dayCommits]) => ({ day, commits: dayCommits }));
};

type Entry = { date: string; node: ReactNode };

const subscribeNever = () => () => {};

function Page() {
	// The page is prerendered for "all" and the static host ignores the query.
	// The first client render must match that HTML, so the filter applies only
	// after hydration.
	const hydrated = useSyncExternalStore(
		subscribeNever,
		() => true,
		() => false,
	);
	const urlKind = Route.useSearch().kind ?? "all";
	const kind = hydrated ? urlKind : "all";
	const { releases: releasesUrl, home } = githubLinks(REPOSITORY);

	const releaseEntries = (releaseKind: "cli" | "mobile"): Entry[] =>
		releases
			.filter((release) => release.kind === releaseKind)
			.map((release) => ({
				date: release.publishedAt,
				node: <ReleaseArticle key={release.tag} release={release} />,
			}));
	// Mobile and CLI commits stay out: their releases already list them.
	const webEntries: Entry[] = groupCommitsByDay(
		webChanges.commits.filter((c) => commitKind(c.subject) === "web"),
	).map((group) => ({
		date: `${group.day}T00:00:00.000Z`,
		node: <WebDayArticle key={group.day} group={group} />,
	}));

	const entries =
		kind === "web"
			? webEntries
			: kind === "all"
				? [
						...releaseEntries("cli"),
						...releaseEntries("mobile"),
						...webEntries,
					].sort((a, b) => b.date.localeCompare(a.date))
				: releaseEntries(kind);

	return (
		<SitePage>
			<section className="fm-container fm-changelog-head">
				<div className="fm-stack fm-changelog-heading">
					<h1 className="fm-h1">
						What <span className="fm-em">changed.</span>
					</h1>
					<p className="fm-lede">
						Newest first. The web app, the mobile app and the CLI are released
						separately.
					</p>
				</div>
				<nav className="fm-segmented" aria-label="Filter by release kind">
					{FILTERS.map((f) => (
						// A plain link, not <Link>: on a first load with `?kind=`,
						// the router still thinks All is active and forces its own
						// `aria-current` over this one, so no filter lit up.
						<a
							key={f.kind}
							href={
								f.kind === "all" ? "/changelog" : `/changelog?kind=${f.kind}`
							}
							aria-current={kind === f.kind ? "page" : undefined}
						>
							{f.label}
						</a>
					))}
				</nav>
			</section>
			<section className="fm-container fm-changelog-list">
				{entries.length === 0 ? (
					<p className="fm-muted fm-changelog-empty">
						No releases to show for this filter yet.
					</p>
				) : (
					entries.map((entry) => entry.node)
				)}
				<div className="fm-changelog-more fm-muted">
					Older releases and the full history are on{" "}
					<a href={releasesUrl}>GitHub releases</a> and the{" "}
					<a href={`${home}/commits`}>commit log</a>.
				</div>
			</section>
		</SitePage>
	);
}

function KindTag({ kind }: { kind: keyof typeof TAGS }) {
	const { label, Icon } = TAGS[kind];
	return (
		<span className={`fm-pill fm-changelog-tag fm-changelog-tag-${kind}`}>
			<Icon weight="duotone" size={14} aria-hidden />
			{label}
		</span>
	);
}

function ReleaseArticle({ release }: { release: ReleaseNote }) {
	return (
		<article className="fm-changelog-item">
			<div className="fm-changelog-meta">
				<KindTag kind={release.kind} />
				<span className="fm-mono fm-changelog-version">{release.version}</span>
				<span className="fm-faint fm-changelog-date">
					{dateFormatter.format(new Date(release.publishedAt))}
				</span>
			</div>
			<div className="fm-changelog-body">
				<h2 className="fm-serif fm-changelog-title">{release.title}</h2>
				{release.notes.length > 0 ? (
					<ul className="fm-muted fm-changelog-notes">
						{release.notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				) : (
					<p className="fm-faint">Build and release changes only.</p>
				)}
			</div>
		</article>
	);
}

function WebDayArticle({ group }: { group: DayGroup }) {
	return (
		<article className="fm-changelog-item">
			<div className="fm-changelog-meta">
				<KindTag kind="web" />
				<span className="fm-mono fm-changelog-version">
					{dateFormatter.format(new Date(`${group.day}T00:00:00.000Z`))}
				</span>
				<span className="fm-faint fm-changelog-date">
					{group.commits.length}{" "}
					{group.commits.length === 1 ? "change" : "changes"}
				</span>
			</div>
			<div className="fm-changelog-body">
				<ul className="fm-muted fm-changelog-notes fm-changelog-commits">
					{group.commits.map((commit) => (
						<li key={commit.sha}>
							<a href={commit.url}>{commit.subject}</a>{" "}
							<span className="fm-mono fm-faint">{commit.shortSha}</span>
						</li>
					))}
				</ul>
			</div>
		</article>
	);
}
