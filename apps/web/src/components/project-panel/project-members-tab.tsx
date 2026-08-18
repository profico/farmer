import type { ProjectRoleValue } from "@farmer/core/schema";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { springProductive } from "#/lib/motion.ts";
import { getInitials } from "#/lib/utils.ts";
import {
	assignableMembersQuery,
	projectMembersQuery,
	projectsQuery,
} from "#/queries/projects.ts";
import { assignProjectMember, removeProjectMember } from "#/server/projects.ts";

// The project role is per assignment, not per person: the same person is PM on
// one project and a plain member on another. Everything a role unlocks is
// scoped to that project alone.
const ROLES: { value: ProjectRoleValue; label: string; hint: string }[] = [
	{
		value: "member",
		label: "Member",
		hint: "Logs their own time. Sees only their own entries.",
	},
	{
		value: "team_lead",
		label: "Team lead",
		hint: "Sees everyone's entries on this project and manages its team.",
	},
	{
		value: "pm",
		label: "PM",
		hint: "Team lead, plus the monthly close and this project's money.",
	},
];

type DraftRow = {
	userId: string;
	name: string;
	email: string;
	role: ProjectRoleValue;
};

const toDraft = (m: {
	userId: string;
	name: string;
	email: string;
	role: ProjectRoleValue;
}): DraftRow => ({
	userId: m.userId,
	name: m.name,
	email: m.email,
	role: m.role,
});

const sameRow = (a: DraftRow, b: DraftRow) => a.role === b.role;

// The selected project's team: who is on it and at what project role. The body
// only — the detail panel owns the header and the tab strip, so this renders the
// same whether it is the panel's Members tab or (in future) anything else that
// needs the roster.
export function ProjectMembersTab({ projectId }: { projectId: string | null }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [addUserId, setAddUserId] = useState("");
	// The draft is tagged with the project it belongs to. Tagging (rather than a
	// separate reset-on-projectId effect) avoids a race: switching to an already
	// cached project changes both `projectId` and `members` in one commit, and a
	// standalone reset effect would blank the freshly-hydrated rows.
	const [draft, setDraft] = useState<{ pid: string; rows: DraftRow[] } | null>(
		null,
	);

	const { data: members, isLoading } = useQuery({
		...projectMembersQuery(orgSlug, projectId ?? ""),
		enabled: !!projectId,
	});
	// Server-side "who isn't on this project yet" — the panel no longer has to
	// diff the whole org membership list against the assignments itself.
	const { data: assignable } = useQuery({
		...assignableMembersQuery(orgSlug, projectId ?? ""),
		enabled: !!projectId,
	});

	// Baseline the draft is diffed against — the server rows keyed by userId.
	const baseline = useMemo(() => {
		const map = new Map<string, DraftRow>();
		for (const m of members ?? []) map.set(m.userId, toDraft(m));
		return map;
	}, [members]);

	// (Re)hydrate whenever the current project's rows are available — this single
	// effect covers both switching projects and post-save refetches.
	useEffect(() => {
		if (projectId && members) {
			setDraft({ pid: projectId, rows: members.map(toDraft) });
		}
	}, [projectId, members]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on projectId — clears the add-member selection when a different project is chosen.
	useEffect(() => {
		setAddUserId("");
	}, [projectId]);

	// Only trust the draft once it's tagged for the currently selected project;
	// during a switch it still holds the previous project until its rows load.
	const hydrated = draft?.pid === projectId;
	const rows = hydrated ? draft.rows : [];
	const assignedIds = useMemo(() => new Set(rows.map((r) => r.userId)), [rows]);
	// The server list is a snapshot; a person added to the draft but not yet
	// saved must still disappear from the picker.
	const unassigned = useMemo(
		() => (assignable ?? []).filter((m) => !assignedIds.has(m.userId)),
		[assignable, assignedIds],
	);

	const dirty = useMemo(() => {
		if (!hydrated) return false;
		if (draft.rows.length !== baseline.size) return true;
		return draft.rows.some((r) => {
			const base = baseline.get(r.userId);
			return !base || !sameRow(r, base);
		});
	}, [hydrated, draft, baseline]);

	const patchRow = (userId: string, patch: Partial<DraftRow>) =>
		setDraft((prev) =>
			prev
				? {
						...prev,
						rows: prev.rows.map((r) =>
							r.userId === userId ? { ...r, ...patch } : r,
						),
					}
				: prev,
		);

	const removeRow = (userId: string) =>
		setDraft((prev) =>
			prev
				? { ...prev, rows: prev.rows.filter((r) => r.userId !== userId) }
				: prev,
		);

	const addRow = (userId: string) => {
		const m = (assignable ?? []).find((x) => x.userId === userId);
		if (!m) return;
		setDraft((prev) =>
			prev
				? {
						...prev,
						rows: [
							...prev.rows,
							{
								userId,
								name: m.name,
								email: m.email,
								role: "member",
							},
						],
					}
				: prev,
		);
		setAddUserId("");
	};

	const saveMutation = useMutation({
		mutationFn: async () => {
			if (!projectId || draft === null) return;
			const rows = draft.rows;
			// Removals: in the baseline but no longer in the draft.
			const removals = [...baseline.keys()].filter(
				(id) => !rows.some((r) => r.userId === id),
			);
			// Upserts: new rows, or rows whose role changed.
			const upserts = rows.filter((r) => {
				const base = baseline.get(r.userId);
				return !base || !sameRow(r, base);
			});
			await Promise.all([
				...removals.map((userId) =>
					removeProjectMember({ data: { projectId, userId } }),
				),
				...upserts.map((r) =>
					assignProjectMember({
						data: { projectId, userId: r.userId, role: r.role },
					}),
				),
			]);
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: projectMembersQuery(orgSlug, projectId ?? "").queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: assignableMembersQuery(orgSlug, projectId ?? "").queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: projectsQuery(orgSlug).queryKey,
				}),
			]);
			toast.success("Members updated");
		},
		onError: (error) => toast.error(error.message ?? "Could not save members"),
	});

	return (
		<div className="flex h-full min-h-0 flex-col">
			{!projectId ? (
				<p className="px-4 py-8 text-base text-muted-foreground">
					Select a project to manage its team.
				</p>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="grid gap-2 pb-5">
						<Label className="eyebrow">Add member</Label>
						<Select
							value={addUserId}
							onValueChange={(v) => v && addRow(v)}
							disabled={unassigned.length === 0}
							items={unassigned.map((m) => ({
								value: m.userId,
								label: m.name,
							}))}
						>
							<SelectTrigger>
								<span className="flex items-center gap-1.5 text-muted-foreground">
									<PlusIcon weight="regular" className="size-3.5" />
									<SelectValue
										placeholder={
											unassigned.length === 0
												? "Everyone's assigned"
												: "Add someone…"
										}
									/>
								</span>
							</SelectTrigger>
							<SelectContent>
								{unassigned.map((m) => (
									<SelectItem key={m.userId} value={m.userId}>
										{m.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{isLoading && !hydrated ? (
						<p className="py-6 text-sm text-muted-foreground">Loading…</p>
					) : rows.length === 0 ? (
						<p className="border-t py-6 text-base text-muted-foreground">
							No one is assigned yet.
						</p>
					) : (
						// Hairline-separated rows rather than a stack of bordered cards:
						// six people in six boxes is six times the framing and no more
						// information than six lines.
						<div className="grid">
							{rows.map((r) => (
								<div
									key={r.userId}
									className="grid gap-3 border-t border-line2 py-4 first:border-t-0 first:pt-0"
								>
									<div className="flex items-center gap-2.5">
										<Avatar size="sm">
											<AvatarFallback>{getInitials(r.name)}</AvatarFallback>
										</Avatar>
										<div className="min-w-0 flex-1">
											<p className="truncate text-base font-medium">{r.name}</p>
											<p className="truncate text-xs text-faint">{r.email}</p>
										</div>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove ${r.name}`}
											onClick={() => removeRow(r.userId)}
										>
											<XIcon weight="regular" className="size-4" />
										</Button>
									</div>
									<div className="grid gap-1.5">
										<Label className="eyebrow">Role</Label>
										<Select
											value={r.role}
											onValueChange={(value) =>
												patchRow(r.userId, {
													role: value as ProjectRoleValue,
												})
											}
											items={ROLES.map((role) => ({
												value: role.value,
												label: role.label,
											}))}
										>
											<SelectTrigger className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{ROLES.map((role) => (
													<SelectItem key={role.value} value={role.value}>
														{role.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-xs text-muted-foreground">
											{ROLES.find((role) => role.value === r.role)?.hint}
										</p>
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			<AnimatePresence>
				{dirty && (
					<motion.div
						className="shrink-0 border-t p-4"
						initial={{ y: 12, opacity: 0 }}
						animate={{ y: 0, opacity: 1 }}
						exit={{ y: 12, opacity: 0 }}
						transition={springProductive}
					>
						<Button
							className="w-full"
							disabled={saveMutation.isPending}
							onClick={() => saveMutation.mutate()}
						>
							{saveMutation.isPending ? "Saving…" : "Save changes"}
						</Button>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
