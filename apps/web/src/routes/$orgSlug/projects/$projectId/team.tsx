import { formatReportHours } from "@farmer/core/lib/report-format";
import { matchesSearch } from "@farmer/core/lib/search";
import type { ProjectRoleValue } from "@farmer/core/schema";
import { ArrowLeftIcon, XIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PersonAvatar } from "#/components/person-avatar.tsx";
import { ProjectIcon } from "#/components/projects/project-icon.tsx";
import { returnLinkClass } from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Combobox,
	ComboboxCollection,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
import {
	Page,
	PageHeader,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import {
	canActOnProjectRole,
	projectPageAccess,
} from "#/lib/project-access.ts";
import {
	assignableMembersQuery,
	myProjectsQuery,
	projectMembersQuery,
	projectQuery,
	projectsQuery,
} from "#/queries/projects.ts";
import {
	assignProjectMember,
	removeProjectMember,
	updateProject,
} from "#/server/projects.ts";

// A project's team: who is on it and at what role, with what each of them
// ever logged here. Roles change in place and save at once; adding and
// removing confirm with an Undo. It replaced a draft-and-Save panel — a
// roster is a list of separate facts, and each one is its own small action.
//
// Team Lead and up (`canManageProjectMembers`). A Team Lead here holds the
// project as a PM does.

const ROLES: { value: ProjectRoleValue; label: string; hint: string }[] = [
	{ value: "member", label: "Member", hint: "Logs time on the project" },
	{
		value: "team_lead",
		label: "Team Lead",
		hint: "Holds the project as a PM does",
	},
	{ value: "pm", label: "PM", hint: "Manages the project and its team" },
];

export const Route = createFileRoute("/$orgSlug/projects/$projectId/team")({
	loader: ({ context, params }) =>
		context.queryClient.ensureQueryData(
			projectQuery(params.orgSlug, params.projectId),
		),
	component: TeamPage,
});

type Person = { value: string; label: string; email: string };

function TeamPage() {
	const { organization, role } = Route.useRouteContext();
	const { projectId } = Route.useParams();
	const orgSlug = organization.slug;
	const isAdmin = role === "owner" || role === "admin";
	const { data: project } = useSuspenseQuery(projectQuery(orgSlug, projectId));
	const access = projectPageAccess(isAdmin, project.myRole);

	const back = (
		<Link
			to="/$orgSlug/projects/$projectId"
			params={{ orgSlug, projectId }}
			className={`${returnLinkClass} inline-flex items-center gap-1`}
		>
			<ArrowLeftIcon weight="regular" className="size-3.5" />
			{project.name}
		</Link>
	);
	const title = (
		<span className="flex items-center gap-3">
			<ProjectIcon icon={project.icon} name={project.name} size="sm" />
			Team
		</span>
	);

	if (!access.canManageTeam) {
		return (
			<Page>
				<PageHeader eyebrow={back} title={title} />
				<p className="max-w-[62ch] text-base text-muted-foreground">
					The team is managed by the project's team leads and PMs.
				</p>
			</Page>
		);
	}

	return (
		<Page>
			<PageHeader
				eyebrow={back}
				title={title}
				lede={`Who may log time on ${project.name}, and who runs it. A PM manages the project; a Team Lead here holds it as a PM does. Changes save straight away.`}
			/>
			<OpenToOrg
				orgSlug={orgSlug}
				projectId={projectId}
				open={project.openToOrg}
				canChange={access.canManageSettings}
			/>
			<Roster
				orgSlug={orgSlug}
				projectId={projectId}
				isAdmin={isAdmin}
				heldRole={project.myRole}
			/>
		</Page>
	);
}

/** Whether everyone in the organization may log time here without being on
 *  the team — the org's Internal project, which a new hire should not wait to
 *  be added to. It grants Member rank only, so the roster below still decides
 *  who runs the project. PM and Admin change it (`canManageProject`); a Team
 *  Lead sees it. */
function OpenToOrg({
	orgSlug,
	projectId,
	open,
	canChange,
}: {
	orgSlug: string;
	projectId: string;
	open: boolean;
	canChange: boolean;
}) {
	const queryClient = useQueryClient();
	const toggle = useMutation({
		mutationFn: (openToOrg: boolean) =>
			updateProject({ data: { projectId, openToOrg } }),
		onSuccess: async (_saved, openToOrg) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: projectQuery(orgSlug, projectId).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: projectsQuery(orgSlug).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: myProjectsQuery(orgSlug).queryKey,
				}),
			]);
			toast.success(
				openToOrg
					? "Everyone in the organization can log time here"
					: "Only the team can log time here",
			);
		},
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});
	return (
		<SettingList className="mb-6 max-w-2xl">
			<SettingRow
				title="Open to everyone"
				description={
					canChange
						? "Everyone in the organization can log time here, on the team or not. Nobody gains a role from it."
						: "Everyone in the organization can log time here, on the team or not. The project's PMs change this."
				}
				action={
					<Switch
						aria-label="Open to everyone"
						checked={open}
						onCheckedChange={(value) => toggle.mutate(value)}
						disabled={!canChange || toggle.isPending}
					/>
				}
			/>
		</SettingList>
	);
}

function Roster({
	orgSlug,
	projectId,
	isAdmin,
	heldRole,
}: {
	orgSlug: string;
	projectId: string;
	isAdmin: boolean;
	heldRole: ProjectRoleValue | null;
}) {
	const queryClient = useQueryClient();
	const { data: members } = useSuspenseQuery(
		projectMembersQuery(orgSlug, projectId),
	);
	const { data: assignable } = useSuspenseQuery(
		assignableMembersQuery(orgSlug, projectId),
	);
	const onTeam = members
		.filter((m) => m.active)
		.sort((a, b) => a.name.localeCompare(b.name, "hr"));
	const onTeamIds = new Set(onTeam.map((m) => m.userId));
	const free: Person[] = assignable
		.filter((p) => !onTeamIds.has(p.userId))
		.map((p) => ({ value: p.userId, label: p.name, email: p.email }));

	// The ceiling `projects.service.ts` enforces on assignMember/removeMember:
	// never above the caller's own held rank. A Team Lead is offered Member and
	// Team Lead here, never PM; a PM (or Admin) is offered all three. Per-row,
	// the same ceiling decides whether THIS person may be touched at all — a
	// Team Lead cannot re-rank or remove a PM, or another Team Lead who reads
	// as PM through the people list.
	const assignableRoles = ROLES.filter((r) =>
		canActOnProjectRole(isAdmin, heldRole, r.value),
	);
	const canManageRow = (m: { role: ProjectRoleValue }) =>
		canActOnProjectRole(isAdmin, heldRole, m.role);

	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: projectMembersQuery(orgSlug, projectId).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: assignableMembersQuery(orgSlug, projectId).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: projectQuery(orgSlug, projectId).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: projectsQuery(orgSlug).queryKey,
			}),
		]);

	// One mutation for every change: an assignment is an upsert, so "set the
	// role", "add" and "undo a removal" are the same call, and a removal is its
	// opposite. The toast's Undo is the reverse call with the old values.
	const assign = useMutation({
		mutationFn: (input: { userId: string; role: ProjectRoleValue }) =>
			assignProjectMember({ data: { projectId, ...input } }),
		onSuccess: refresh,
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});
	const remove = useMutation({
		mutationFn: (input: { userId: string }) =>
			removeProjectMember({ data: { projectId, userId: input.userId } }),
		onSuccess: refresh,
		onError: (error) => toast.error(error.message ?? "Could not remove"),
	});
	const undoable = (message: string, undo: () => void) =>
		toast.success(message, { action: { label: "Undo", onClick: undo } });

	const setRole = (m: (typeof onTeam)[number], next: ProjectRoleValue) => {
		if (next === m.role) return;
		assign.mutate(
			{ userId: m.userId, role: next },
			{
				onSuccess: () =>
					undoable(
						`${m.name} is now ${ROLES.find((r) => r.value === next)?.label}`,
						() => assign.mutate({ userId: m.userId, role: m.role }),
					),
			},
		);
	};
	const removePerson = (m: (typeof onTeam)[number]) =>
		remove.mutate(
			{ userId: m.userId },
			{
				onSuccess: () =>
					undoable(`${m.name} removed from the team`, () =>
						assign.mutate({ userId: m.userId, role: m.role }),
					),
			},
		);
	const addPerson = (p: Person) =>
		assign.mutate(
			{ userId: p.value, role: "member" },
			{
				onSuccess: () =>
					undoable(`${p.label} added as Member`, () =>
						remove.mutate({ userId: p.value }),
					),
			},
		);

	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Person</TableHead>
						<TableHead>Role</TableHead>
						<TableHead className="text-right">All-time hours</TableHead>
						<TableHead>Last entry</TableHead>
						<TableHead className="w-10" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{onTeam.length === 0 ? (
						<TableRow>
							<TableCell colSpan={5} className="py-8 text-muted-foreground">
								Nobody is on this project yet.
							</TableCell>
						</TableRow>
					) : (
						onTeam.map((m) => {
							const manageable = canManageRow(m);
							// A disabled row still needs its current role in `items`, or
							// the Base UI trigger shows the raw value instead of the
							// resolved label — a PM's row read as "pm" once a Team Lead's
							// options no longer included it.
							const rowRoles = manageable ? assignableRoles : ROLES;
							return (
								<TableRow key={m.userId}>
									<TableCell>
										<span className="flex items-center gap-3">
											<PersonAvatar userId={m.userId} name={m.name} />
											<span className="min-w-0">
												<span className="block font-medium">{m.name}</span>
												<span className="block truncate text-xs text-muted-foreground">
													{m.email}
												</span>
											</span>
										</span>
									</TableCell>
									<TableCell>
										<Select
											items={rowRoles.map((r) => ({
												value: r.value,
												label: r.label,
											}))}
											value={m.role}
											disabled={!manageable}
											onValueChange={(next: string | null) => {
												const picked = rowRoles.find((r) => r.value === next);
												if (picked) setRole(m, picked.value);
											}}
										>
											<SelectTrigger
												className="h-8 w-32 text-sm"
												aria-label={`Role of ${m.name}`}
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{rowRoles.map((r) => (
													<SelectItem key={r.value} value={r.value}>
														{r.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<span className="mt-1 block text-xs text-muted-foreground">
											{ROLES.find((r) => r.value === m.role)?.hint}
										</span>
									</TableCell>
									<TableCell className="mono text-right text-muted-foreground">
										{formatReportHours(m.allTimeSeconds)}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{m.lastEntry ? formatDateKeyLong(m.lastEntry) : "—"}
									</TableCell>
									<TableCell className="text-right">
										{manageable && (
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Remove ${m.name} from the project`}
												disabled={remove.isPending}
												onClick={() => removePerson(m)}
											>
												<XIcon weight="regular" />
											</Button>
										)}
									</TableCell>
								</TableRow>
							);
						})
					)}
				</TableBody>
			</Table>

			<div className="mt-4 flex flex-wrap items-center gap-3">
				<AddPerson
					people={free}
					onPick={addPerson}
					pending={assign.isPending}
				/>
				<span className="text-sm text-muted-foreground">
					Added as Member; change the role after.
				</span>
			</div>
			<p className="mt-4 max-w-[72ch] text-sm text-muted-foreground">
				Removing someone keeps their history on the project; they just can't log
				more time on it.
			</p>
		</>
	);
}

/** The searchable list of people not yet on the team. Nothing is chosen for
 *  long: picking adds the person and the box empties. */
function AddPerson({
	people,
	onPick,
	pending,
}: {
	people: Person[];
	onPick: (p: Person) => void;
	pending: boolean;
}) {
	const [query, setQuery] = useState("");
	const filtered = useMemo(
		() =>
			query.trim() === ""
				? people
				: people.filter((p) => matchesSearch(query, [p.label, p.email])),
		[people, query],
	);
	return (
		<Combobox
			items={people}
			filteredItems={filtered}
			value={null}
			onValueChange={(item: Person | null) => {
				if (item) onPick(item);
			}}
			isItemEqualToValue={(a: Person, b: Person) => a.value === b.value}
			itemToStringLabel={(item: Person) => item.label}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
			}}
			autoHighlight
			disabled={pending || people.length === 0}
		>
			<ComboboxTrigger className="w-56" aria-label="Add a person">
				<ComboboxValue>
					{() =>
						people.length === 0 ? "Everyone is on the team" : "Add a person…"
					}
				</ComboboxValue>
			</ComboboxTrigger>
			<ComboboxContent searchPlaceholder="Search people…">
				<ComboboxEmpty>Nobody matches.</ComboboxEmpty>
				<ComboboxList>
					<ComboboxCollection>
						{(item: Person) => (
							<ComboboxItem key={item.value} value={item}>
								<span className="truncate">{item.label}</span>
								<span className="shrink-0 text-xs text-muted-foreground">
									{item.email}
								</span>
							</ComboboxItem>
						)}
					</ComboboxCollection>
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}
