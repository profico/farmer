import { formatDurationInput, parseDuration } from "@farmer/core/lib/time";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { closeSheetQuery } from "#/queries/close.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";
import { absenceForUserQuery } from "#/queries/time-entries.ts";
import {
	createAbsenceForUser,
	overrideAbsenceEntry,
	removeAbsenceEntry,
} from "#/server/time-entries.ts";

/**
 * The PM's correction of somebody else's Vacation / Sick Leave (PRD 3.5) — the
 * one place in the product where a person edits another person's entries, and
 * deliberately limited to absence. Worked-time corrections belong in the
 * Adjusted column, which is what keeps "what they said they worked" and "what
 * we billed" two separate numbers.
 *
 * Distinct from the absence-days override in the column beside it: this writes
 * real entries (so the Absence report and the person's own timesheet both
 * change), the override writes only the close sheet. When they disagree, that
 * gap is the signal that someone forgot to log — which is why correcting the
 * entries here is offered next to, not instead of, the override.
 */
export function AbsenceEntriesDialog({
	projectId,
	year,
	month,
	userId,
	name,
	computedDays,
}: {
	projectId: string;
	year: number;
	month: number;
	userId: string;
	name: string;
	computedDays: number;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button variant="ghost" size="xs" className="mono">
						{computedDays}d
					</Button>
				}
			/>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{name}'s absence</DialogTitle>
				</DialogHeader>
				{/* Mounted only while open, so the sheet doesn't fire one of these
				    queries per row the moment it renders. */}
				{open && (
					<Suspense
						fallback={
							<p className="py-6 text-sm text-muted-foreground">Loading…</p>
						}
					>
						<AbsenceEditor
							projectId={projectId}
							year={year}
							month={month}
							userId={userId}
						/>
					</Suspense>
				)}
			</DialogContent>
		</Dialog>
	);
}

function AbsenceEditor({
	projectId,
	year,
	month,
	userId,
}: {
	projectId: string;
	year: number;
	month: number;
	userId: string;
}) {
	const queryClient = useQueryClient();
	const { data: entries } = useSuspenseQuery(
		absenceForUserQuery({ userId, year, month }),
	);
	// No project → the two absence tasks, which is exactly the list here.
	const { data: absenceTasks } = useSuspenseQuery(
		tasksForProjectQuery(undefined),
	);

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: absenceForUserQuery({ userId, year, month }).queryKey,
			}),
			// The close sheet recomputes its absence days (and Expected with them)
			// from these entries.
			queryClient.invalidateQueries({
				queryKey: closeSheetQuery({ projectId, year, month }).queryKey,
			}),
			queryClient.invalidateQueries({ queryKey: ["reports", "absence"] }),
		]);

	const onError = (error: Error) =>
		toast.error(error.message ?? "Could not save");

	const update = useMutation({
		mutationFn: (vars: { timeEntryId: string; durationSeconds: number }) =>
			overrideAbsenceEntry({ data: vars }),
		onSuccess: invalidate,
		onError,
	});

	const remove = useMutation({
		mutationFn: (timeEntryId: string) =>
			removeAbsenceEntry({ data: timeEntryId }),
		onSuccess: invalidate,
		onError,
	});

	const add = useMutation({
		mutationFn: (vars: {
			taskId: string;
			date: string;
			durationSeconds: number;
		}) => createAbsenceForUser({ data: { userId, ...vars } }),
		onSuccess: invalidate,
		onError,
	});

	const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
	const [date, setDate] = useState(firstOfMonth);
	const [taskId, setTaskId] = useState(absenceTasks[0]?.id ?? "");
	const [hours, setHours] = useState("8");

	const taskItems = absenceTasks.map((t) => ({ value: t.id, label: t.name }));

	return (
		<div className="grid gap-5">
			<div className="flex flex-col">
				{entries.length === 0 && (
					<p className="text-sm text-muted-foreground">
						Nothing logged for this month. If they were away, add it here — the
						entry is theirs, and it shows up on their timesheet too.
					</p>
				)}
				{entries.map((entry) => (
					<div
						key={entry.id}
						className="flex items-center gap-3 border-t border-line2 py-2 first:border-t-0 first:pt-0"
					>
						<span className="w-40 shrink-0 text-sm">
							{formatDateKeyLong(entry.date)}
						</span>
						<span className="flex-1 truncate text-sm text-muted-foreground">
							{entry.taskName}
						</span>
						<HoursInput
							seconds={entry.durationSeconds}
							disabled={update.isPending}
							onCommit={(durationSeconds) =>
								update.mutate({ timeEntryId: entry.id, durationSeconds })
							}
						/>
						<Button
							variant="ghost"
							size="sm"
							disabled={remove.isPending}
							onClick={() => remove.mutate(entry.id)}
						>
							Delete
						</Button>
					</div>
				))}
			</div>

			<form
				className="flex flex-wrap items-end gap-2 border-t pt-4"
				onSubmit={(e) => {
					e.preventDefault();
					const parsed = parseDuration(hours);
					if (!taskId || parsed == null || parsed <= 0) return;
					add.mutate({ taskId, date, durationSeconds: parsed });
				}}
			>
				<Input
					type="date"
					className="h-8 w-40 text-xs"
					value={date}
					onChange={(e) => setDate(e.target.value)}
				/>
				<Select
					items={taskItems}
					value={taskId}
					onValueChange={(next: string | null) => next && setTaskId(next)}
				>
					<SelectTrigger className="h-8 w-40 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{taskItems.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					className="mono h-8 w-20 text-right text-xs"
					value={hours}
					onChange={(e) => setHours(e.target.value)}
				/>
				<Button type="submit" size="sm" disabled={add.isPending}>
					Add
				</Button>
			</form>
		</div>
	);
}

// Same commit-on-blur shape as the close sheet's own cells: a half-typed number
// must never round-trip to the server.
function HoursInput({
	seconds,
	disabled,
	onCommit,
}: {
	seconds: number;
	disabled: boolean;
	onCommit: (seconds: number) => void;
}) {
	const [text, setText] = useState(formatDurationInput(seconds));
	useEffect(() => {
		setText(formatDurationInput(seconds));
	}, [seconds]);

	return (
		<Input
			className="mono h-8 w-20 text-right text-xs"
			value={text}
			disabled={disabled}
			onChange={(e) => setText(e.target.value)}
			onBlur={() => {
				const parsed = parseDuration(text.trim());
				if (parsed == null || parsed <= 0) {
					setText(formatDurationInput(seconds));
					return;
				}
				if (parsed === seconds) return;
				onCommit(parsed);
			}}
		/>
	);
}
