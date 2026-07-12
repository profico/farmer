import { formatDurationLong } from "@farmer/core/lib/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCommitHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AddBlockDialog,
	type ExistingTimeEntry,
} from "#/components/time/add-block-dialog.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "#/components/ui/alert-dialog.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
	deleteTimeEntry,
	updateTimeEntryDescription,
} from "#/server/time-entries.ts";

export type EntryBlockRowEntry = ExistingTimeEntry & {
	type: { name: string; color: string | null };
	project: { name: string } | null;
	task: { name: string } | null;
	commitCount?: number;
};

export function EntryBlockRow({
	entry,
	timezone,
	dateOptions,
}: {
	entry: EntryBlockRowEntry;
	timezone: string;
	dateOptions: { value: string; label: string }[];
}) {
	const queryClient = useQueryClient();
	const [deleteOpen, setDeleteOpen] = useState(false);

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
			await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
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

	const deleteMutation = useMutation({
		mutationFn: () => deleteTimeEntry({ data: entry.id }),
		onSuccess: async () => {
			setDeleteOpen(false);
			await queryClient.invalidateQueries({ queryKey: ["time-entries"] });
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not delete time entry");
		},
	});

	return (
		<div className="flex items-center gap-3 px-4 py-2.5 sm:px-8">
			<span
				className="size-2 shrink-0 rounded-full"
				style={{
					backgroundColor: entry.type.color ?? "var(--muted-foreground)",
				}}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="truncate text-sm font-medium">
						{entry.type.name}
						{entry.project ? ` — ${entry.project.name}` : ""}
						{entry.task ? ` / ${entry.task.name}` : ""}
					</p>
					{entry.fillsDay && (
						<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
							Rest of day
						</span>
					)}
					{!!entry.commitCount && entry.commitCount > 0 && (
						<span
							className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
							title={`${entry.commitCount} linked commit${entry.commitCount === 1 ? "" : "s"}`}
						>
							<GitCommitHorizontal className="size-3" />
							{entry.commitCount}
						</span>
					)}
				</div>
				<Textarea
					value={note}
					onChange={(event) => setNote(event.target.value)}
					onBlur={saveNote}
					placeholder="Add a note…"
					rows={1}
					className="mt-0.5 min-h-8 w-full resize-y rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm text-muted-foreground shadow-none [field-sizing:content] placeholder:text-muted-foreground/60 hover:border-input focus-visible:border-ring focus-visible:bg-card focus-visible:text-foreground"
				/>
			</div>
			<span className="shrink-0 text-sm text-muted-foreground tabular-nums">
				{formatDurationLong(entry.durationSeconds)}
			</span>
			<AddBlockDialog
				timezone={timezone}
				dateOptions={dateOptions}
				entry={entry}
				trigger={
					<Button variant="ghost" size="sm">
						Edit
					</Button>
				}
			/>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogTrigger
					render={
						<Button variant="ghost" size="sm">
							Delete
						</Button>
					}
				/>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete this time entry?</AlertDialogTitle>
						<AlertDialogDescription>
							This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => deleteMutation.mutate()}
							disabled={deleteMutation.isPending}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
