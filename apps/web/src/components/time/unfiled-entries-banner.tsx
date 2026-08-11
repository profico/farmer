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
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { springProductive } from "#/lib/motion.ts";
import { queryKeys } from "#/queries/keys.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { unfiledEntriesQuery } from "#/queries/time-entries.ts";
import { fileTimeEntry } from "#/server/time-entries.ts";

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
	const [open, setOpen] = useState(false);
	const from = shiftKey(todayKey, -NAG_DAYS_BACK);

	const { data: entries } = useQuery({
		...unfiledEntriesQuery(from, todayKey),
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
						className="mb-4 overflow-hidden rounded-lg border bg-secondary"
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
	const queryClient = useQueryClient();
	const { data: entries } = useQuery({
		...unfiledEntriesQuery(from, to),
		enabled: open,
	});
	const { data: projects } = useQuery({ ...projectsQuery(), enabled: open });

	// Archived projects are dormant: you don't file new time against one.
	const items = (projects ?? [])
		.filter((p) => p.status === "active")
		.map((p) => ({ value: p.id, label: p.name }));

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
						Pick the project each entry belongs to. Built-in tasks fit any
						project; for the rest, the project has to offer that task — if yours
						doesn't, an admin adds it under Settings → Tasks.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col divide-y">
					{(entries ?? []).map((entry) => (
						<UnfiledRow
							key={entry.id}
							entry={entry}
							items={items}
							onFiled={() =>
								queryClient.invalidateQueries({
									queryKey: [...queryKeys.timeEntries],
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
			</DialogContent>
		</Dialog>
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

function UnfiledRow({
	entry,
	items,
	onFiled,
}: {
	entry: UnfiledEntry;
	items: { value: string; label: string }[];
	onFiled: () => void;
}) {
	const mutation = useMutation({
		mutationFn: (projectId: string) =>
			fileTimeEntry({ data: { timeEntryId: entry.id, projectId } }),
		onSuccess: onFiled,
		// The service re-checks that the project actually offers this task, so a
		// stale project list surfaces as a real message rather than a silent no-op.
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<div className="flex items-center gap-3 py-3">
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">
					{entry.description || entry.taskName}
				</p>
				<p className="text-xs text-muted-foreground">
					{formatDateKeyLong(entry.date)} · {entry.taskName} ·{" "}
					{formatHoursShort(entry.durationSeconds)}
				</p>
			</div>
			<Select
				items={items}
				onValueChange={(value) => mutation.mutate(value as string)}
				disabled={mutation.isPending}
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
		</div>
	);
}
