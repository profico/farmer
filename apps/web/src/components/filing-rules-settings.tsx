import { TrayIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ProjectPicker } from "#/components/pickers/project-picker.tsx";
import { TaskPicker } from "#/components/pickers/task-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { filingRulesQuery } from "#/queries/filing-rules.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { selectableTasksQuery } from "#/queries/tasks.ts";
import { deleteFilingRule, updateFilingRule } from "#/server/filing-rules.ts";

// The management half of "Always file these here" (see
// UnfiledEntriesBanner). A rule set from a dialog and then never visible again
// is a setting you cannot remember making and cannot undo, so the list has to
// live somewhere — and Preferences is where it belongs rather than
// Integrations, because a rule is a personal filing habit and applies whether
// or not a calendar is connected.
//
// The project and the task are edited in place. The title is not: it is the
// key the sync matches on, and a different title is a different rule.
//
// `useQuery`, not `useSuspenseQuery`: this section is additive to a page that
// already renders, and nothing here is worth blocking first paint for. It
// renders nothing at all until there is a rule, so the common case — somebody
// who never ticked the box — sees no explanation of a feature they aren't using.
export function FilingRulesSettings() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: rules } = useQuery(filingRulesQuery(orgSlug));
	const hasRules = (rules?.length ?? 0) > 0;
	const { data: projects } = useQuery({
		...myProjectsQuery(orgSlug),
		enabled: hasRules,
	});
	const { data: tasks } = useQuery({
		...selectableTasksQuery(orgSlug),
		enabled: hasRules,
	});

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).filingRules],
		});

	const updateMutation = useMutation({
		mutationFn: (data: {
			id: string;
			projectId: string;
			targetTaskId: string | null;
		}) => updateFilingRule({ data }),
		onSuccess: async () => {
			await invalidate();
			toast.success("Rule updated");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const removeMutation = useMutation({
		mutationFn: (id: string) => deleteFilingRule({ data: { id } }),
		onSuccess: async () => {
			await invalidate();
			toast.success("Rule removed");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	if (!rules || rules.length === 0) return null;

	const busy = updateMutation.isPending || removeMutation.isPending;

	return (
		<PageSection
			title="Automatic filing"
			description="Entries with these names are filed against their project and task: meetings as soon as they sync, and blocks as Assemble my day proposes them, instead of waiting for you in File your time. Changing or removing a rule leaves entries it already filed alone."
		>
			<SettingList>
				{rules.map((rule) => (
					<SettingRow
						key={rule.id}
						icon={<TrayIcon className="size-5 text-muted-foreground" />}
						title={rule.title}
						description={rule.taskName}
						action={
							<div className="flex flex-wrap items-center gap-2">
								<ProjectPicker
									projects={projects ?? []}
									value={rule.projectId}
									onValueChange={(projectId) => {
										if (!projectId || projectId === rule.projectId) return;
										updateMutation.mutate({
											id: rule.id,
											projectId,
											targetTaskId: rule.targetTaskId,
										});
									}}
									disabled={busy}
									className="w-60"
									aria-label={`Project for ${rule.title}`}
								/>
								<TaskPicker
									tasks={tasks ?? []}
									value={rule.targetTaskId ?? ""}
									onValueChange={(taskId) => {
										const targetTaskId = taskId || null;
										if (targetTaskId === rule.targetTaskId) return;
										updateMutation.mutate({
											id: rule.id,
											projectId: rule.projectId,
											targetTaskId,
										});
									}}
									grouped
									noTask={`Keep ${rule.taskName}`}
									disabled={busy}
									className="w-48"
									aria-label={`Task for ${rule.title}`}
								/>
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => removeMutation.mutate(rule.id)}
								>
									Remove
								</Button>
							</div>
						}
					/>
				))}
			</SettingList>
		</PageSection>
	);
}
