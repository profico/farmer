import { GitCommitIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
	AddBlockDialog,
	type ExistingTimeEntry,
} from "#/components/time/add-block-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { springProductive } from "#/lib/motion.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	createTimeEntry,
	deleteTimeEntry,
	setTimeEntryOvertime,
	updateTimeEntryDescription,
} from "#/server/time-entries.ts";

export type EntryBlockRowEntry = ExistingTimeEntry & {
	project: {
		name: string;
		code: string | null;
		client: { name: string } | null;
	} | null;
	task: { name: string; color: string | null; isAbsence: boolean };
	commitCount?: number;
};

/** Harvest's row heading: "[CODE] Project (Client)". The code is what people
 *  actually say out loud, so it leads; an absence has neither and just names
 *  itself. */
export function entryHeading(entry: EntryBlockRowEntry): string {
	if (!entry.project) return entry.task.name;
	const code = entry.project.code ? `[${entry.project.code}] ` : "";
	const client = entry.project.client ? ` (${entry.project.client.name})` : "";
	return `${code}${entry.project.name}${client}`;
}

export function EntryBlockRow({
	entry,
	timezone,
	dateOptions,
}: {
	entry: EntryBlockRowEntry;
	timezone: string;
	dateOptions: { value: string; label: string }[];
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	// Inline note editing: local draft synced from the server value, saved on
	// blur only when it actually changed.
	const [note, setNote] = useState(entry.description ?? "");
	useEffect(() => {
		setNote(entry.description ?? "");
	}, [entry.description]);

	const noteMutation = useMutation({
		mutationFn: (description: string) =>
			updateTimeEntryDescription({
				data: { timeEntryId: entry.id, description },
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save note");
			setNote(entry.description ?? "");
		},
	});

	const saveNote = () => {
		const trimmed = note.trimEnd();
		if (trimmed === (entry.description ?? "")) return;
		noteMutation.mutate(trimmed);
	};

	const overtimeMutation = useMutation({
		mutationFn: (overtime: boolean) =>
			setTimeEntryOvertime({ data: { timeEntryId: entry.id, overtime } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update overtime");
		},
	});

	// Re-creates a just-deleted entry from its server snapshot, used by the undo
	// toast. Under the duration-only model this is a straight field copy — there
	// are no timestamps to reconstruct.
	const restore = async (deleted: {
		projectId: string | null;
		taskId: string;
		description: string;
		date: string;
		durationSeconds: number;
		overtime: boolean;
		meetingUrl: string | null;
		calendarEventId: string | null;
	}) => {
		try {
			await createTimeEntry({
				data: {
					taskId: deleted.taskId,
					projectId: deleted.projectId ?? undefined,
					description: deleted.description || undefined,
					date: deleted.date,
					durationSeconds: deleted.durationSeconds,
					overtime: deleted.overtime,
					fillsDay: false,
					// Carried so a restored meeting keeps its link — and so the service
					// clears the tombstone the delete just wrote, which is what makes
					// undo work at all for a synced meeting.
					meetingUrl: deleted.meetingUrl ?? undefined,
					calendarEventId: deleted.calendarEventId ?? undefined,
				},
			});
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not restore entry",
			);
		}
	};

	// The collapse is driven from local state rather than from an `exit` prop,
	// because the row is the only thing that knows it is being deleted.
	//
	// It used to be an AnimatePresence `exit`, which had two failure modes. The
	// loud one: presence knows a row *left*, not *why*, so paging to another day
	// replaced every entry at once and the whole list played the delete
	// animation. The silent one: motion compares `presenceContext` against
	// `prevPresenceContext` to spot the leaving edge, but shifts that pair on
	// every commit — so when the delete's query invalidation landed several
	// commits in a burst, the edge was consumed unobserved, the exit never ran,
	// and `onExitComplete` never fired. AnimatePresence then held the row in the
	// DOM permanently: a full-height entry, showing time that was no longer
	// logged, next to a total that no longer counted it.
	const [collapsing, setCollapsing] = useState(false);

	const deleteMutation = useMutation({
		mutationFn: () => deleteTimeEntry({ data: entry.id }),
		onSuccess: async (deleted) => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timeEntries],
			});
			// Fill blocks are derived, and a rule-generated entry leaves a skip behind
			// (re-creating it as a manual copy would double up) — neither can be
			// restored by re-creating a row, so neither offers undo.
			//
			// A calendar-linked entry USED to be in that list, because deleting one
			// writes a tombstone the sync engine honours forever. It offers undo now:
			// re-creating an entry with its `calendarEventId` clears that tombstone
			// (timeEntriesService.create), so the restore is real and the meeting is
			// not lost to one misclick.
			const undoable =
				deleted && !deleted.fillsDay && !deleted.generatedFromRuleId;
			if (undoable) {
				toast("Entry deleted", {
					action: { label: "Undo", onClick: () => restore(deleted) },
				});
			} else {
				toast("Entry deleted");
			}
		},
		onError: (error) => {
			// Put the row back — it is still there, and a collapsed one would read
			// as deleted while the toast says otherwise.
			setCollapsing(false);
			toast.error(error.message ?? "Could not delete time entry");
		},
	});

	return (
		// Wraps on a phone. The figure and the three word-buttons are a fixed
		// ~180px; holding them on the same line as the text squeezed a project
		// name down to a dozen characters and turned every note into a five-line
		// column, so below `sm` they drop to their own right-aligned line.
		//
		// Delete only, no enter. Deleting a row used to drop it instantly and snap
		// everything below it upward while the "Undo" toast slid in from the far
		// corner — two unrelated movements for one action, and no clue which row
		// the toast was offering back. Collapsing the row instead keeps the two
		// tied together. There is deliberately no matching enter: a new row
		// arrives as its dialog closes, and that beat is already covered.
		//
		// Collapsing and deleting start together rather than in sequence: the
		// request is never gated on an animation finishing, so a frame that never
		// arrives can cost the collapse but never the delete.
		//
		// `overflow-hidden` is what makes the collapse read as the row closing
		// rather than its contents spilling; the controls inside are inset far
		// enough from the edges that it never clips a focus ring.
		// `prefers-reduced-motion` is handled globally by the root
		// <MotionConfig reducedMotion="user">.
		<motion.div
			animate={
				collapsing
					? { height: 0, opacity: 0, paddingTop: 0, paddingBottom: 0 }
					: undefined
			}
			transition={springProductive}
			className="group/entry flex flex-wrap items-start gap-x-3 gap-y-1 overflow-hidden px-4 py-3 transition-colors duration-(--dur-fast) hover:bg-muted sm:flex-nowrap sm:px-8"
		>
			<span
				className="mt-1.5 size-2 shrink-0 rounded-full"
				style={{
					backgroundColor: entry.task.color ?? "var(--muted-foreground)",
				}}
			/>
			<div className="min-w-0 flex-1">
				{/* Project line, then task line, then the note — Harvest's three-tier
				    row. The hierarchy is load-bearing: you scan for the project, then
				    confirm the task, and only read the note if you need detail. */}
				<div className="flex flex-wrap items-center gap-2">
					<p className="truncate text-base font-medium">
						{entryHeading(entry)}
					</p>
					{entry.fillsDay && (
						<span className="eyebrow shrink-0 rounded-full bg-muted px-1.5 py-0.5">
							Rest of day
						</span>
					)}
					{entry.overtime && (
						<span className="eyebrow shrink-0 rounded-full bg-warn/12 px-1.5 py-0.5 text-warn">
							Overtime
						</span>
					)}
					{!!entry.commitCount && entry.commitCount > 0 && (
						<span
							className="mono flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground"
							title={`${entry.commitCount} linked commit${entry.commitCount === 1 ? "" : "s"}`}
						>
							<GitCommitIcon className="size-3" />
							{entry.commitCount}
						</span>
					)}
				</div>
				{entry.project && (
					<p className="text-sm text-muted-foreground">{entry.task.name}</p>
				)}
				<Textarea
					value={note}
					onChange={(event) => setNote(event.target.value)}
					onBlur={saveNote}
					placeholder="Add a note…"
					rows={1}
					className="mt-0.5 -ml-1.5 min-h-7 w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-muted-foreground shadow-none [field-sizing:content] placeholder:text-faint hover:border-input focus-visible:border-ring focus-visible:bg-background focus-visible:text-foreground"
				/>
			</div>
			<div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto sm:items-start sm:gap-3">
				<span className="mono mr-auto text-base sm:mt-0.5 sm:mr-0">
					{formatClock(entry.durationSeconds)}
				</span>
				{/* Overtime is a one-click toggle from the row: it is purely manual, and
				    making people reopen the dialog for it guarantees it never gets set. */}
				{!entry.task.isAbsence && !entry.fillsDay && (
					<Button
						variant="ghost"
						size="sm"
						className={cn("text-faint", entry.overtime && "text-warn")}
						onClick={() => overtimeMutation.mutate(!entry.overtime)}
						disabled={overtimeMutation.isPending}
					>
						OT
					</Button>
				)}
				<AddBlockDialog
					timezone={timezone}
					dateOptions={dateOptions}
					entry={entry}
					trigger={
						<Button variant="ghost" size="sm" className="text-faint">
							Edit
						</Button>
					}
				/>
				<Button
					variant="ghost"
					size="sm"
					className="text-faint hover:text-primary"
					onClick={() => {
						setCollapsing(true);
						deleteMutation.mutate();
					}}
					disabled={deleteMutation.isPending}
				>
					Delete
				</Button>
			</div>
		</motion.div>
	);
}
