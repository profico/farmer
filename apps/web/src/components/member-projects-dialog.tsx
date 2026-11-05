import type { ProjectRoleValue } from "@farmer/core/schema";
import { XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { ListLoadingSkeleton } from "#/components/states/loading-skeleton.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { queryKeys } from "#/queries/keys.ts";
import { projectsQuery, userProjectsQuery } from "#/queries/projects.ts";
import { assignProjectMember, removeProjectMember } from "#/server/projects.ts";

const ROLES: { value: ProjectRoleValue; label: string }[] = [
	{ value: "member", label: "Member" },
	{ value: "team_lead", label: "Team Lead" },
	{ value: "pm", label: "PM" },
];

function RoleSelect({
	value,
	onChange,
	label,
	disabled,
}: {
	value: ProjectRoleValue;
	onChange: (role: ProjectRoleValue) => void;
	label: string;
	disabled?: boolean;
}) {
	return (
		<Select
			items={ROLES}
			disabled={disabled}
			value={value}
			onValueChange={(next: string | null) => {
				const picked = ROLES.find((r) => r.value === next);
				if (picked) onChange(picked.value);
			}}
		>
			<SelectTrigger className="h-8 w-32 text-sm" aria-label={label}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{ROLES.map((r) => (
					<SelectItem key={r.value} value={r.value}>
						{r.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/**
 * The projects one person is assigned to — edited by an Admin, from the
 * Members page. It reuses the project page's calls (`assignMember` is an
 * upsert, so adding and changing the role are the same call), and the service
 * applies the same rules there, so this adds no new permission.
 */
export function MemberProjectsDialog({
	person,
	archived,
	trigger,
}: {
	person: { userId: string; name: string };
	archived: boolean;
	trigger: ReactElement;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [newProject, setNewProject] = useState<string | null>(null);
	const [newRole, setNewRole] = useState<ProjectRoleValue>("member");

	const assigned = useQuery({
		...userProjectsQuery(orgSlug, person.userId),
		enabled: open,
	});
	const all = useQuery({ ...projectsQuery(orgSlug), enabled: open });

	// `assignMember` is an upsert: until the assignments load, an "add" of a
	// project the person already has would silently overwrite its role.
	const canAdd = !archived && assigned.isSuccess;
	const taken = new Set((assigned.data ?? []).map((a) => a.projectId));
	const addable = (all.data ?? [])
		.filter((p) => p.status === "active" && !taken.has(p.id))
		.map((p) => ({ value: p.id, label: `${p.client.name} / ${p.name}` }));

	// The project page reads the same assignments under the projects and
	// time-entries roots, and what the person may open under access.
	const refresh = () =>
		Promise.all(
			[
				queryKeys(orgSlug).projects,
				queryKeys(orgSlug).timeEntries,
				queryKeys(orgSlug).access,
			].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
		);

	const assign = useMutation({
		mutationFn: (input: { projectId: string; role: ProjectRoleValue }) =>
			assignProjectMember({ data: { userId: person.userId, ...input } }),
		onSuccess: refresh,
		onError: (error: Error) => toast.error(error.message),
	});
	const remove = useMutation({
		mutationFn: (projectId: string) =>
			removeProjectMember({ data: { userId: person.userId, projectId } }),
		onSuccess: refresh,
		onError: (error: Error) => toast.error(error.message),
	});

	const add = () => {
		if (!newProject) return;
		assign.mutate(
			{ projectId: newProject, role: newRole },
			{ onSuccess: () => setNewProject(null) },
		);
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{person.name}'s projects</DialogTitle>
					<DialogDescription>
						The projects {person.name} is assigned to. A change here is the same
						as a change on the project's Team page.
					</DialogDescription>
				</DialogHeader>
				<div className="scrollbar-stable -mx-6 max-h-80 divide-y divide-line2 overflow-y-auto border-y border-line2">
					{assigned.isPending && <ListLoadingSkeleton rows={2} />}
					{assigned.isError && (
						<p className="px-6 py-6 text-center text-sm text-destructive">
							Could not load the assignments. {assigned.error.message}
						</p>
					)}
					{assigned.data?.length === 0 && (
						<p className="px-6 py-6 text-center text-sm text-muted-foreground">
							Not assigned to any project.
						</p>
					)}
					{(assigned.data ?? []).map((a) => (
						<div
							key={a.projectId}
							className="flex items-center gap-3 px-6 py-2"
						>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm">{a.projectName}</span>
								<span className="block truncate text-xs text-muted-foreground">
									{a.clientName}
									{a.status === "archived" && " (archived)"}
								</span>
							</span>
							<RoleSelect
								value={a.role}
								label={`Role on ${a.projectName}`}
								disabled={archived}
								onChange={(role) =>
									role !== a.role &&
									assign.mutate({ projectId: a.projectId, role })
								}
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Remove from ${a.projectName}`}
								disabled={remove.isPending}
								onClick={() => remove.mutate(a.projectId)}
							>
								<XIcon />
							</Button>
						</div>
					))}
				</div>
				{!archived && (
					<div className="flex items-center gap-2">
						<Select
							items={addable}
							disabled={!canAdd}
							value={newProject}
							onValueChange={(next: string | null) => setNewProject(next)}
						>
							<SelectTrigger className="h-8 min-w-0 flex-1 text-sm">
								<SelectValue placeholder="Add a project…" />
							</SelectTrigger>
							<SelectContent>
								{addable.map((p) => (
									<SelectItem key={p.value} value={p.value}>
										{p.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<RoleSelect
							value={newRole}
							onChange={setNewRole}
							label="New role"
						/>
						<Button
							size="sm"
							onClick={add}
							disabled={!canAdd || !newProject || assign.isPending}
						>
							Add
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
