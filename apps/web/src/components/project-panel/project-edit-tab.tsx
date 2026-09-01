import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ProjectEditForm } from "#/components/project-panel/project-edit-form.tsx";
import { ProjectTasksPicker } from "#/components/project-panel/project-tasks-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { archiveProject, unarchiveProject } from "#/server/projects.ts";

export type PanelProject = {
	id: string;
	name: string;
	color: string | null;
	status: string;
};

/**
 * Everything that is a property of the project itself: its name and colour, the
 * tasks it offers, and whether it is still active.
 *
 * These were three separate row-action dialogs. They are one tab because they
 * answer one question — "what is this project?" — and because a menu whose
 * every item opens a modal is a menu doing the job of a panel badly.
 *
 * The two capabilities differ and the server enforces both: editing the record
 * and archiving it are PM-and-up (`assertCanCloseProject`), while the task
 * subset is Team-Lead-and-up. So a Team Lead sees this tab with only the task
 * picker on it. Hiding what you cannot do beats rendering a control whose only
 * outcome is the service's refusal.
 */
export function ProjectEditTab({
	project,
	canEdit,
	canManageTasks,
}: {
	project: PanelProject;
	canEdit: boolean;
	canManageTasks: boolean;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const archived = project.status === "archived";

	const statusMutation = useMutation({
		mutationFn: () =>
			archived
				? unarchiveProject({ data: project.id })
				: archiveProject({ data: project.id }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectsQuery(orgSlug).queryKey,
			});
			toast.success(archived ? "Project restored" : "Project archived");
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not change the project's status"),
	});

	return (
		<div className="grid gap-6">
			{canEdit && (
				// `key` on the project id, not on the component's position: the form
				// seeds its fields from props in an effect, and remounting per project
				// is what guarantees a half-typed rename cannot survive a selection
				// change into another project's form.
				<ProjectEditForm
					key={project.id}
					project={project}
					footer={({ pending, dirty }) => (
						<Button
							type="submit"
							className="mt-1 w-full"
							disabled={pending || !dirty}
						>
							{pending ? "Saving…" : "Save changes"}
						</Button>
					)}
				/>
			)}

			{canManageTasks && (
				<div className={canEdit ? "border-t border-line2 pt-6" : undefined}>
					<ProjectTasksPicker projectId={project.id} />
				</div>
			)}

			{canEdit && (
				<div className="border-t border-line2 pt-6">
					<p className="eyebrow">
						{archived ? "Archived project" : "Archive project"}
					</p>
					<p className="mt-2 text-sm leading-normal text-muted-foreground">
						{archived
							? "This project is dormant. Its time is still counted and reportable; it just accepts no new entries."
							: "An archived project stops accepting new entries. Nothing is deleted and it can be restored at any time."}
					</p>
					<Button
						variant="outline"
						className="mt-3 w-full"
						disabled={statusMutation.isPending}
						onClick={() => statusMutation.mutate()}
					>
						{statusMutation.isPending
							? "Working…"
							: archived
								? "Restore project"
								: "Archive project"}
					</Button>
				</div>
			)}

			{!canEdit && !canManageTasks && (
				<p className="text-base text-muted-foreground">
					You don't have permission to change this project's settings.
				</p>
			)}
		</div>
	);
}
