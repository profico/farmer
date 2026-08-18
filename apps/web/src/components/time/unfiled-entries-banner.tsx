import { TrayIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { springProductive } from "#/lib/motion.ts";
import { queryKeys } from "#/queries/keys.ts";
import { myProjectsQuery } from "#/queries/projects.ts";
import { unfiledEntriesQuery } from "#/queries/time-entries.ts";
import { fileTimeEntries } from "#/server/time-entries.ts";

// Everything the engines write lands with no project: the calendar sync files
// meetings this way, and so do commit fill blocks and accepted day-assembly
// suggestions. That time is real and counts toward the day, but it is invisible
// to every project report and it blocks the month's finalization, so it needs a
// surface. This is it.
//
// Deliberately NOT dismissible, unlike AutoTrackNag: that one nudges you toward
// an optional feature, this one is a worklist of your own unattributed hours.

// The window we nag about. Ends today: the sync pre-imports meetings up to two
// weeks out, and nagging someone to file a meeting that hasn't happened yet is
// noise. 62 days is the cap listTimeEntriesRangeInput enforces.
const NAG_DAYS_BACK = 61;

const shiftKey = (key: string, days: number) => {
	const d = new Date(`${key}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

export function UnfiledEntriesBanner({ todayKey }: { todayKey: string }) {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const from = shiftKey(todayKey, -NAG_DAYS_BACK);

	const { data: entries } = useQuery({
		...unfiledEntriesQuery(orgSlug, from, todayKey),
		staleTime: 60_000,
	});

	const count = entries?.length ?? 0;
	const seconds = (entries ?? []).reduce(
		(sum, e) => sum + e.durationSeconds,
		0,
	);

	return (
		<>
			<AnimatePresence initial={false}>
				{count > 0 && (
					<motion.div
						key="unfiled-entries"
						initial={{ height: 0, opacity: 0 }}
						animate={{ height: "auto", opacity: 1 }}
						exit={{ height: 0, opacity: 0 }}
						transition={springProductive}
						className="mb-4 shrink-0 overflow-hidden rounded-lg border bg-secondary"
					>
						<div className="flex items-center gap-3 px-4 py-3">
							<TrayIcon className="size-4 shrink-0 text-primary" />
							<div className="min-w-0 flex-1">
								<p className="text-base font-medium">
									{count === 1
										? "1 entry isn't filed against a project"
										: `${count} entries aren't filed against a project`}
								</p>
								<p className="text-sm text-muted-foreground">
									{formatHoursShort(seconds)} of tracked time won't appear in
									any project report until you file it.
								</p>
							</div>
							<Button size="sm" onClick={() => setOpen(true)}>
								File them
							</Button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

			<FileEntriesDialog
				open={open}
				onOpenChange={setOpen}
				from={from}
				to={todayKey}
			/>
		</>
	);
}

type UnfiledEntry = {
	id: string;
	date: string;
	description: string;
	durationSeconds: number;
	taskId: string;
	taskName: string;
};

/** Entries that are the same piece of recurring work: same task, same title,
 *  same length. A weekly stand-up is forty rows of one answer, and answering it
 *  forty times is the whole complaint about this screen. */
type UnfiledGroup = {
	key: string;
	title: string;
	taskName: string;
	entries: UnfiledEntry[];
	seconds: number;
};

const groupUnfiled = (entries: UnfiledEntry[]): UnfiledGroup[] => {
	const byKey = new Map<string, UnfiledGroup>();
	for (const entry of entries) {
		const title = entry.description || entry.taskName;
		const key = `${entry.taskId}|${title.trim().toLowerCase()}|${entry.durationSeconds}`;
		const group = byKey.get(key);
		if (group) {
			group.entries.push(entry);
			group.seconds += entry.durationSeconds;
		} else {
			byKey.set(key, {
				key,
				title,
				taskName: entry.taskName,
				entries: [entry],
				seconds: entry.durationSeconds,
			});
		}
	}
	// Biggest backlog first — the recurring meeting that produced thirty rows is
	// the one worth answering, and it should not be buried under one-offs.
	return [...byKey.values()].sort(
		(a, b) => b.entries.length - a.entries.length || b.seconds - a.seconds,
	);
};

function FileEntriesDialog({
	open,
	onOpenChange,
	from,
	to,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	from: string;
	to: string;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: entries } = useQuery({
		...unfiledEntriesQuery(orgSlug, from, to),
		enabled: open,
	});
	// `myProjectsQuery`, not `projectsQuery`: this dropdown is a "file this time
	// against" picker, and the write behind it (`timeEntriesService.update`)
	// asserts `canTrackOn`. Listing every project in the organization offered
	// choices the server was always going to refuse — pick one you are not
	// assigned to and filing failed with "You are not assigned to this project".
	// Every other entry picker in the app (add-block, add-row) already asks this
	// question this way.
	const { data: projects } = useQuery({
		...myProjectsQuery(orgSlug),
		enabled: open,
	});

	// Archived projects are dormant: you don't file new time against one.
	const items = (projects ?? [])
		.filter((p) => p.status === "active")
		.map((p) => ({ value: p.id, label: p.name }));

	const groups = groupUnfiled(entries ?? []);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [projectId, setProjectId] = useState<string | null>(null);

	// Start clean on each open: the list behind it has changed, and a selection
	// carried over from last time would be filing rows nobody just looked at.
	const [wasOpen, setWasOpen] = useState(false);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSelectedIds(new Set());
			setProjectId(null);
		}
	}

	const toggleGroup = (group: UnfiledGroup) => {
		setSelectedIds((current) => {
			const next = new Set(current);
			const allIn = group.entries.every((e) => next.has(e.id));
			for (const entry of group.entries) {
				if (allIn) next.delete(entry.id);
				else next.add(entry.id);
			}
			return next;
		});
	};

	const selectedSeconds = (entries ?? [])
		.filter((e) => selectedIds.has(e.id))
		.reduce((sum, e) => sum + e.durationSeconds, 0);

	const fileMutation = useMutation({
		mutationFn: () =>
			fileTimeEntries({
				data: { timeEntryIds: [...selectedIds], projectId: projectId ?? "" },
			}),
		onSuccess: async ({ filed, failed, firstError }) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			setSelectedIds(new Set());
			if (failed > 0) {
				// The one real failure here is a task the project hasn't picked, so
				// say which rule was hit rather than just how many rows bounced.
				toast.error(
					`Filed ${filed}, ${failed} could not be filed: ${firstError ?? "unknown reason"}`,
				);
			} else {
				toast.success(`Filed ${filed} ${filed === 1 ? "entry" : "entries"}`);
			}
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>File your time</DialogTitle>
					{/* Built-ins deliberately unnamed here: which tasks are universal is
					    the service's call (isUniversalTask), and hardcoding "Meeting and
					    Break" into copy is the same string coupling that made the engines
					    brittle in the first place. */}
					<DialogDescription>
						Pick the entries that belong to a project and file them together.
						Built-in tasks fit any project; for the rest, the project has to
						offer that task — if yours doesn't, an admin adds it under Settings
						→ Tasks.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col divide-y">
					{groups.map((group) => (
						<UnfiledGroupRow
							key={group.key}
							group={group}
							selectedIds={selectedIds}
							onToggleGroup={() => toggleGroup(group)}
							onToggleEntry={(id) =>
								setSelectedIds((current) => {
									const next = new Set(current);
									if (next.has(id)) next.delete(id);
									else next.add(id);
									return next;
								})
							}
						/>
					))}
					{entries?.length === 0 && (
						<p className="py-8 text-center text-sm text-muted-foreground">
							Everything's filed.
						</p>
					)}
				</div>

				{groups.length > 0 && (
					<DialogFooter className="items-center gap-3">
						<span className="mr-auto text-xs text-muted-foreground">
							{selectedIds.size === 0
								? "Nothing selected"
								: `${selectedIds.size} selected · ${formatHoursShort(selectedSeconds)}`}
						</span>
						<Select
							items={items}
							value={projectId}
							onValueChange={(value) => setProjectId(value as string)}
						>
							<SelectTrigger className="w-52 shrink-0">
								<SelectValue placeholder="Pick a project" />
							</SelectTrigger>
							<SelectContent>
								{items.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							disabled={
								selectedIds.size === 0 || !projectId || fileMutation.isPending
							}
							onClick={() => fileMutation.mutate()}
						>
							{fileMutation.isPending ? "Filing…" : "File"}
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

function UnfiledGroupRow({
	group,
	selectedIds,
	onToggleGroup,
	onToggleEntry,
}: {
	group: UnfiledGroup;
	selectedIds: Set<string>;
	onToggleGroup: () => void;
	onToggleEntry: (id: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const allIn = group.entries.every((e) => selectedIds.has(e.id));
	const someIn = !allIn && group.entries.some((e) => selectedIds.has(e.id));
	const isRecurring = group.entries.length > 1;

	return (
		<div className="py-3">
			<div className="flex items-center gap-3">
				<input
					type="checkbox"
					className="accent-primary"
					checked={allIn}
					ref={(node) => {
						// The only honest state for a partly-selected group. Set through a
						// ref because `indeterminate` is a DOM property with no attribute.
						if (node) node.indeterminate = someIn;
					}}
					onChange={onToggleGroup}
					aria-label={`Select ${group.title}`}
				/>
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm font-medium">{group.title}</p>
					<p className="text-xs text-muted-foreground">
						{group.taskName} · {formatHoursShort(group.seconds)}
						{isRecurring
							? ` · ${group.entries.length} occurrences`
							: ` · ${formatDateKeyLong(group.entries[0]?.date ?? "")}`}
					</p>
				</div>
				{isRecurring && (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setExpanded((current) => !current)}
					>
						{expanded ? "Hide dates" : "Show dates"}
					</Button>
				)}
			</div>

			{expanded && (
				<div className="mt-2 ml-7 flex flex-col gap-1.5">
					{group.entries.map((entry) => (
						<label
							key={entry.id}
							className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
						>
							<input
								type="checkbox"
								className="accent-primary"
								checked={selectedIds.has(entry.id)}
								onChange={() => onToggleEntry(entry.id)}
							/>
							{formatDateKeyLong(entry.date)} ·{" "}
							{formatHoursShort(entry.durationSeconds)}
						</label>
					))}
				</div>
			)}
		</div>
	);
}
