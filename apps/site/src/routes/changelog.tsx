import { BrowserIcon, GitCommitIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";

import { SitePage } from "#/components/site/site-chrome.tsx";

import "#/components/site/changelog.css";
import { githubLinks, REPOSITORY } from "#/lib/links.ts";
import { releases, webChanges } from "#/lib/releases.ts";
import type { ReleaseNote, WebCommit } from "#/lib/releases.ts";

const KINDS = ["all", "web", "cli"] as const;
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
	{ kind: "cli", label: "CLI" },
];

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

function Page() {
	const kind = Route.useSearch().kind ?? "all";
	const { releases: releasesUrl, home } = githubLinks(REPOSITORY);

	const cliReleases = releases.filter((release) => release.kind === "cli");
	const dayGroups = groupCommitsByDay(webChanges.commits);

	const cliEntries: Entry[] = cliReleases.map((release) => ({
		date: release.publishedAt,
		node: <ReleaseArticle key={release.tag} release={release} />,
	}));
	const webEntries: Entry[] = dayGroups.map((group) => ({
		date: `${group.day}T00:00:00.000Z`,
		node: <WebDayArticle key={group.day} group={group} />,
	}));

	const entries =
		kind === "cli"
			? cliEntries
			: kind === "web"
				? webEntries
				: [...cliEntries, ...webEntries].sort((a, b) =>
						b.date.localeCompare(a.date),
					);

	return (
		<SitePage>
			<section className="fm-container fm-changelog-head">
				<div className="fm-stack fm-changelog-heading">
					<h1 className="fm-h1">
						What <span className="fm-em">changed.</span>
					</h1>
					<p className="fm-lede">
						Newest first. The web app and the CLI are released separately.
					</p>
				</div>
				<nav className="fm-segmented" aria-label="Filter by release kind">
					{FILTERS.map((f) => (
						<Link
							key={f.kind}
							to="/changelog"
							search={f.kind === "all" ? {} : { kind: f.kind }}
							// The router marks an active link `aria-current="page"`
							// itself, and by default an empty search matches every
							// search, so All lit up on every filter. Exact matching
							// makes its answer the same as this one.
							activeOptions={{ exact: true, includeSearch: true }}
							aria-current={kind === f.kind ? "page" : undefined}
						>
							{f.label}
						</Link>
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

function ReleaseArticle({ release }: { release: ReleaseNote }) {
	return (
		<article className="fm-changelog-item">
			<div className="fm-changelog-meta">
				<span className="fm-pill fm-changelog-tag fm-changelog-tag-cli">
					<GitCommitIcon weight="duotone" size={14} aria-hidden />
					CLI
				</span>
				<span className="fm-mono fm-changelog-version">{release.version}</span>
				<span className="fm-faint fm-changelog-date">
					{dateFormatter.format(new Date(release.publishedAt))}
				</span>
			</div>
			<div className="fm-changelog-body">
				<h2 className="fm-serif fm-changelog-title">{release.title}</h2>
				<ul className="fm-muted fm-changelog-notes">
					{release.notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			</div>
		</article>
	);
}

function WebDayArticle({ group }: { group: DayGroup }) {
	return (
		<article className="fm-changelog-item">
			<div className="fm-changelog-meta">
				<span className="fm-pill fm-changelog-tag fm-changelog-tag-web">
					<BrowserIcon weight="duotone" size={14} aria-hidden />
					Web
				</span>
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
