import { relations, sql } from "drizzle-orm";
import {
	boolean,
	check,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";

import type {
	PullRequestActivityKind,
	PullRequestReviewState,
} from "../../lib/github-activity";
import { organization, user } from "./auth";
import { project, timeEntry } from "./domain";

const ts = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });
const org = () =>
	text("organization_id")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" });
const stamps = {
	createdAt: ts("created_at").notNull().defaultNow(),
	updatedAt: ts("updated_at").notNull().defaultNow(),
};

// A GitHub App installation connected to an organization. The app is
// installed on a GitHub account (org or personal); each install grants the
// app access to a chosen set of repos. An org can connect multiple GitHub
// accounts (multiple installations). Repo/commit reads use installation
// tokens minted from this installationId — never a user's OAuth token.
export const orgGithubInstallation = pgTable(
	"org_github_installation",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		// GitHub's numeric installation id (stable per install).
		installationId: integer("installation_id").notNull(),
		// The account the app is installed on (e.g. "acme"), cached for display.
		accountLogin: text("account_login").notNull(),
		// "Organization" | "User".
		accountType: text("account_type").notNull(),
		connectedByUserId: text("connected_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		...stamps,
	},
	(t) => [
		index("ogi_org_idx").on(t.organizationId),
		unique("ogi_org_installation_unq").on(t.organizationId, t.installationId),
	],
);

// A GitHub repo linked to a project, for commit suggestions. Keyed on
// GitHub's immutable numeric repo id (not owner/name) so renames/transfers
// don't break the link; owner/name/private are cached at link time for
// display without re-resolving.
export const projectGithubRepo = pgTable(
	"project_github_repo",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		organizationId: org(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		githubRepoId: integer("github_repo_id").notNull(),
		// Which installation granted access to this repo — the source of the
		// installation token used to read its commits. Nullable for rows linked
		// before installations existed.
		installationId: integer("installation_id"),
		owner: text("owner").notNull(),
		name: text("name").notNull(),
		fullName: text("full_name").notNull(),
		private: boolean("private").notNull().default(false),
		linkedByUserId: text("linked_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		...stamps,
	},
	(t) => [
		index("pgr_org_idx").on(t.organizationId),
		index("pgr_project_idx").on(t.projectId),
		// A repo belongs to exactly ONE project, org-wide — not one row per
		// (project, repo) pair. The commit engine reads a commit's project off
		// its repo, so a repo on two projects makes "which project did this
		// commit bill to" unanswerable: the sync would attach the same commit to
		// two entries and the rest-of-day block could not name a project at all.
		// Linking a repo already linked elsewhere is a move, and the service says
		// which project holds it rather than surfacing a constraint violation.
		unique("pgr_org_repo_unq").on(t.organizationId, t.githubRepoId),
	],
);

// A commit attached to a time entry as a reference. All display fields are
// cached at attach time (never live-joined), so a later force-push or
// GitHub disconnect doesn't change what's already attached.
export const timeEntryGithubCommit = pgTable(
	"time_entry_github_commit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		timeEntryId: uuid("time_entry_id")
			.notNull()
			.references(() => timeEntry.id, { onDelete: "cascade" }),
		// set null (not cascade): keep the historical commit record on the
		// entry if the repo link is later removed — only the "jump to repo"
		// affordance degrades.
		projectGithubRepoId: uuid("project_github_repo_id").references(
			() => projectGithubRepo.id,
			{ onDelete: "set null" },
		),
		sha: text("sha").notNull(),
		message: text("message").notNull(),
		authorLogin: text("author_login"),
		committedAt: ts("committed_at").notNull(),
		url: text("url").notNull(),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("tegc_time_entry_idx").on(t.timeEntryId),
		unique("tegc_entry_sha_unq").on(t.timeEntryId, t.sha),
	],
);

// A pull request event attached to a time entry as evidence — the PR-shaped
// twin of `timeEntryGithubCommit`, and cached the same way, so a PR retitled
// or deleted later does not change what the entry already says.
//
// One row per EVENT, not per pull request: opening a PR on Monday and merging
// it on Thursday is evidence for two different days, and three reviews on one
// PR are three sittings. `eventId` is what makes a re-run a no-op — a review's
// own node id, or `<pr node id>:<kind>` for the events a PR has at most one of.
export const timeEntryGithubPrActivity = pgTable(
	"time_entry_github_pr_activity",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		timeEntryId: uuid("time_entry_id")
			.notNull()
			.references(() => timeEntry.id, { onDelete: "cascade" }),
		// set null, as on commits: unlinking the repo keeps the history.
		projectGithubRepoId: uuid("project_github_repo_id").references(
			() => projectGithubRepo.id,
			{ onDelete: "set null" },
		),
		eventId: text("event_id").notNull(),
		kind: text("kind").$type<PullRequestActivityKind>().notNull(),
		// Only on `reviewed`.
		reviewState: text("review_state").$type<PullRequestReviewState>(),
		number: integer("number").notNull(),
		title: text("title").notNull(),
		pullRequestUrl: text("pull_request_url").notNull(),
		// The review's own link for `reviewed`, the PR's otherwise.
		url: text("url").notNull(),
		occurredAt: ts("occurred_at").notNull(),
		createdAt: ts("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("tegpa_time_entry_idx").on(t.timeEntryId),
		unique("tegpa_entry_event_unq").on(t.timeEntryId, t.eventId),
		check(
			"tegpa_kind_chk",
			sql`${t.kind} in ('opened', 'merged', 'closed', 'reviewed')`,
		),
	],
);

export const orgGithubInstallationRelations = relations(
	orgGithubInstallation,
	({ one }) => ({
		connectedByUser: one(user, {
			fields: [orgGithubInstallation.connectedByUserId],
			references: [user.id],
		}),
	}),
);

export const projectGithubRepoRelations = relations(
	projectGithubRepo,
	({ one, many }) => ({
		project: one(project, {
			fields: [projectGithubRepo.projectId],
			references: [project.id],
		}),
		linkedByUser: one(user, {
			fields: [projectGithubRepo.linkedByUserId],
			references: [user.id],
		}),
		commits: many(timeEntryGithubCommit),
		pullRequestActivity: many(timeEntryGithubPrActivity),
	}),
);

export const timeEntryGithubPrActivityRelations = relations(
	timeEntryGithubPrActivity,
	({ one }) => ({
		timeEntry: one(timeEntry, {
			fields: [timeEntryGithubPrActivity.timeEntryId],
			references: [timeEntry.id],
		}),
		repo: one(projectGithubRepo, {
			fields: [timeEntryGithubPrActivity.projectGithubRepoId],
			references: [projectGithubRepo.id],
		}),
	}),
);

export const timeEntryGithubCommitRelations = relations(
	timeEntryGithubCommit,
	({ one }) => ({
		timeEntry: one(timeEntry, {
			fields: [timeEntryGithubCommit.timeEntryId],
			references: [timeEntry.id],
		}),
		repo: one(projectGithubRepo, {
			fields: [timeEntryGithubCommit.projectGithubRepoId],
			references: [projectGithubRepo.id],
		}),
	}),
);
