import { useEffect, useState } from "react";

import {
	type PanelProject,
	ProjectEditTab,
} from "#/components/project-panel/project-edit-tab.tsx";
import { ProjectGithubRepos } from "#/components/project-panel/project-github-repos.tsx";
import { ProjectMembersTab } from "#/components/project-panel/project-members-tab.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";

/**
 * Everything you can do to one project, in one place.
 *
 * It replaced a row-actions menu whose every item opened a modal — Edit
 * project, Manage tasks, Manage GitHub repos, Archive — which meant the
 * project's configuration had no home, only four doors. The panel is the home;
 * the menu is gone at every width.
 *
 * ONE implementation, two containers. The projects route renders this inline in
 * a right rail from `lg` up and inside a Sheet below it. That split is the
 * route's business, not this component's: it is a `h-full` column either way, so
 * nothing here knows which one it is in. Building the small-screen path as its
 * own set of dialogs is what produced the four doors in the first place.
 *
 * Tabs are client state rather than route search params on purpose: which
 * sub-panel you last had open is not a place, and putting it in the URL would
 * make every project row click a navigation with a tab in it.
 */
export type ProjectCapabilities = {
	/** Rename, recolour, archive — `assertCanCloseProject`, so PM and up. */
	canEdit: boolean;
	/** The project's task subset — Team Lead and up. */
	canManageTasks: boolean;
	/** Assign people and set their project role — Team Lead and up. */
	canManageMembers: boolean;
	/** Link repositories — `orgAdminMiddleware`, so Admin only. */
	canManageRepos: boolean;
};

type TabValue = "edit" | "members" | "github";

export function ProjectDetailPanel({
	project,
	orgSlug,
	capabilities,
}: {
	project: PanelProject | null;
	orgSlug: string;
	capabilities: ProjectCapabilities;
}) {
	const { canEdit, canManageTasks, canManageMembers, canManageRepos } =
		capabilities;

	// A tab that would render nothing but a refusal is not offered. The services
	// re-check all four regardless — this only decides what is worth showing.
	const tabs = [
		(canEdit || canManageTasks) && { value: "edit" as const, label: "Edit" },
		canManageMembers && { value: "members" as const, label: "Members" },
		canManageRepos && { value: "github" as const, label: "GitHub" },
	].filter((t) => t !== false);

	const [tab, setTab] = useState<TabValue>("members");

	// Two different reasons the current tab can stop existing: nothing is
	// selected, or the newly selected project grants a different set (project
	// roles are per assignment — the same person is PM here and a member there).
	// Falling back to the first available tab is what stops the panel rendering
	// an empty body after a selection change.
	const available = tabs.map((t) => t.value);
	const activeTab = available.includes(tab) ? tab : available[0];
	useEffect(() => {
		if (activeTab && activeTab !== tab) setTab(activeTab);
	}, [activeTab, tab]);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b px-4 py-3.5">
				<p className="eyebrow">Project</p>
				<p className="mt-1.5 truncate text-base font-medium">
					{project?.name ?? "No project selected"}
				</p>
				{project && tabs.length > 1 && (
					<SegmentedControl className="mt-3 flex w-full">
						{tabs.map((t) => (
							<SegmentedControlItem
								key={t.value}
								active={activeTab === t.value}
								className="flex-1 px-2"
								onClick={() => setTab(t.value)}
							>
								{t.label}
							</SegmentedControlItem>
						))}
					</SegmentedControl>
				)}
			</div>

			{!project ? (
				<p className="px-4 py-8 text-base text-muted-foreground">
					Select a project to configure it.
				</p>
			) : activeTab === "members" ? (
				// Not wrapped in a scroller like the other two: the members tab owns
				// its own, because its Save bar is pinned below that scroller rather
				// than scrolling with the roster.
				<ProjectMembersTab projectId={project.id} />
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					{activeTab === "github" ? (
						<ProjectGithubRepos
							projectId={project.id}
							projectName={project.name}
							orgSlug={orgSlug}
						/>
					) : activeTab === "edit" ? (
						<ProjectEditTab
							project={project}
							canEdit={canEdit}
							canManageTasks={canManageTasks}
						/>
					) : (
						<p className="text-base text-muted-foreground">
							You don't have permission to configure this project.
						</p>
					)}
				</div>
			)}
		</div>
	);
}
