import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { springProductive } from "#/lib/motion.ts";
import { getInitials } from "#/lib/utils.ts";
import { membersQuery } from "#/queries/members.ts";
import { projectMembersQuery, projectsQuery } from "#/queries/projects.ts";
import { assignProjectMember, removeProjectMember } from "#/server/projects.ts";

type DraftRow = {
	userId: string;
	name: string;
	email: string;
	isVacationApprover: boolean;
	billableRate: string;
	costRate: string;
};

// Normalizes a server member row into the draft shape (rates ⇒ "" when null).
const toDraft = (m: {
	userId: string;
	name: string;
	email: string;
	isVacationApprover: boolean;
	billableRate: string | null;
	costRate: string | null;
}): DraftRow => ({
	userId: m.userId,
	name: m.name,
	email: m.email,
	isVacationApprover: m.isVacationApprover,
	billableRate: m.billableRate ?? "",
	costRate: m.costRate ?? "",
});

const sameRow = (a: DraftRow, b: DraftRow) =>
	a.isVacationApprover === b.isVacationApprover &&
	a.billableRate === b.billableRate &&
	a.costRate === b.costRate;

// Persistent right-rail panel that manages the selected project's members.
// Lives inline in the projects page (not an overlay) and swaps its contents
// as the selected project changes.
export function ProjectMembersPanel({
	projectId,
	projectName,
}: {
	projectId: string | null;
	projectName: string | null;
}) {
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
		...projectMembersQuery(projectId ?? ""),
		enabled: !!projectId,
	});
	const { data: orgMembers } = useQuery(membersQuery());

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
	const unassigned = useMemo(
		() => (orgMembers?.members ?? []).filter((m) => !assignedIds.has(m.userId)),
		[orgMembers, assignedIds],
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
		const m = (orgMembers?.members ?? []).find((x) => x.userId === userId);
		if (!m) return;
		setDraft((prev) =>
			prev
				? {
						...prev,
						rows: [
							...prev.rows,
							{
								userId,
								name: m.user.name,
								email: m.user.email,
								isVacationApprover: false,
								billableRate: "",
								costRate: "",
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
			// Upserts: new rows, or rows whose fields changed.
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
						data: {
							projectId,
							userId: r.userId,
							isVacationApprover: r.isVacationApprover,
							billableRate: r.billableRate || null,
							costRate: r.costRate || null,
						},
					}),
				),
			]);
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: projectMembersQuery(projectId ?? "").queryKey,
				}),
				queryClient.invalidateQueries({ queryKey: projectsQuery().queryKey }),
			]);
			toast.success("Members updated");
		},
		onError: (error) => toast.error(error.message ?? "Could not save members"),
	});

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b px-4 py-3.5">
				<p className="text-sm font-medium">Members</p>
				<p className="truncate text-xs text-muted-foreground">
					{projectName ?? "No project selected"}
				</p>
			</div>

			{!projectId ? (
				<p className="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground">
					Select a project to manage its members.
				</p>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					<div className="grid gap-2 pb-4">
						<Label className="text-2xs">Add member</Label>
						<Select
							value={addUserId}
							onValueChange={(v) => v && addRow(v)}
							disabled={unassigned.length === 0}
							items={unassigned.map((m) => ({
								value: m.userId,
								label: m.user.name,
							}))}
						>
							<SelectTrigger>
								<span className="flex items-center gap-1.5 text-muted-foreground">
									<PlusIcon className="size-3.5" />
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
										{m.user.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{isLoading && !hydrated ? (
						<p className="py-6 text-center text-sm text-muted-foreground">
							Loading…
						</p>
					) : rows.length === 0 ? (
						<p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
							No one is assigned yet.
						</p>
					) : (
						<div className="grid gap-2">
							{rows.map((r) => (
								<div
									key={r.userId}
									className="grid gap-3 rounded-lg border p-3"
								>
									<div className="flex items-center gap-2.5">
										<Avatar size="sm">
											<AvatarFallback>{getInitials(r.name)}</AvatarFallback>
										</Avatar>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">{r.name}</p>
											<p className="truncate text-2xs text-muted-foreground">
												{r.email}
											</p>
										</div>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove ${r.name}`}
											onClick={() => removeRow(r.userId)}
										>
											<XIcon className="size-4" />
										</Button>
									</div>
									<div className="flex items-center justify-between gap-2">
										<Label className="text-2xs font-normal text-muted-foreground">
											Can approve time off
										</Label>
										<Switch
											checked={r.isVacationApprover}
											onCheckedChange={(checked) =>
												patchRow(r.userId, { isVacationApprover: checked })
											}
										/>
									</div>
									<div className="grid grid-cols-2 gap-2">
										<div className="grid gap-1">
											<Label className="text-2xs font-normal text-muted-foreground">
												Billable rate
											</Label>
											<Input
												inputMode="decimal"
												value={r.billableRate}
												onChange={(e) =>
													patchRow(r.userId, { billableRate: e.target.value })
												}
												placeholder="—"
											/>
										</div>
										<div className="grid gap-1">
											<Label className="text-2xs font-normal text-muted-foreground">
												Cost rate
											</Label>
											<Input
												inputMode="decimal"
												value={r.costRate}
												onChange={(e) =>
													patchRow(r.userId, { costRate: e.target.value })
												}
												placeholder="—"
											/>
										</div>
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
