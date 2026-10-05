import { addDaysToKey } from "@farmer/core/lib/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MenuPath } from "#/components/menu-path.tsx";
import { Button } from "#/components/ui/button.tsx";
import { DatePicker } from "#/components/ui/date-picker.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { tasksForProjectQuery } from "#/queries/tasks.ts";
import { logAbsenceRange } from "#/server/time-entries.ts";

type AbsenceRangeResult = Awaited<ReturnType<typeof logAbsenceRange>>;

/** The service's own ceiling (`logAbsenceRangeInput`), restated here only so the
 *  button can say why it is disabled instead of the server saying it after a
 *  round trip. The validator remains the authority. */
const MAX_SPAN_DAYS = 62;

const daysBetween = (from: string, to: string) =>
	(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
	86_400_000;

/**
 * Skipped reasons, in the reader's second person.
 *
 * The service phrases them for any caller ("not a working day for this person"),
 * which is right for the assistant and wrong on a screen the person is looking
 * at. Anything unrecognised falls through verbatim — the list also carries real
 * per-day failures, and a reworded reason must degrade to being shown rather
 * than disappearing.
 */
const skipReasonLabel = (reason: string) => {
	if (reason === "public holiday") return "Public holiday";
	if (reason === "not a working day for this person")
		return "Not a working day for you";
	if (reason === "absence already logged") return "Already booked off";
	if (reason === "could not be logged") return "Could not be logged";
	return reason;
};

/**
 * Booking Vacation / Sick Leave as a span of days.
 *
 * The reason this exists next to the ordinary block dialog rather than inside
 * it: absence is asked for as "I'm off the 4th to the 15th", and through the
 * entry form that is ten trips through a form whose duration field the person
 * has no business filling in. How long a day off is isn't theirs to type — it
 * is their own working-hours schedule, and which days count is the org's
 * holiday calendar. Both live on the server, so the span goes there whole and
 * `timeEntriesService.logAbsenceRange` expands it.
 *
 * Half days stay with the block dialog on purpose. This one books whole
 * working days; a four-hour Friday off is an entry, not a span.
 */
export function BookTimeOffDialog({
	orgSlug,
	defaultDate,
	trigger,
}: {
	orgSlug: string;
	/** The day the view is showing — the span opens on it rather than on today,
	 *  so booking from a month six weeks out doesn't start by scrolling back. */
	defaultDate: string;
	trigger: React.ReactElement;
}) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	const [taskId, setTaskId] = useState("");
	const [from, setFrom] = useState(defaultDate);
	const [to, setTo] = useState(defaultDate);
	const [description, setDescription] = useState("");
	// Only ever set when something was skipped — see the mutation's onSuccess.
	const [result, setResult] = useState<AbsenceRangeResult | null>(null);

	// Every opening starts clean. A dialog that reopens on the last span booked
	// invites booking it twice, and the receipt from last time is stale the
	// moment it closes.
	useEffect(() => {
		if (open) {
			setTaskId("");
			setFrom(defaultDate);
			setTo(defaultDate);
			setDescription("");
			setResult(null);
		}
	}, [open, defaultDate]);

	// The project-less task list is every site built-in — Meeting and Break come
	// with it — so absence is filtered out of it here, the same way the close
	// sheet's absence editor does.
	const tasksQ = useQuery({
		...tasksForProjectQuery(orgSlug, undefined),
		enabled: open,
	});
	const absenceTasks = (tasksQ.data ?? []).filter((t) => t.isAbsence);

	// With one absence task there is nothing to decide; with two there is, and
	// Vacation vs Sick Leave is not a choice to make on the person's behalf. The
	// pair cannot be told apart from the outside anyway — names are editable and
	// `systemKey` never reaches the client, so a "sensible default" here would
	// have to guess by name, which is the lookup the task taxonomy exists to
	// stop.
	useEffect(() => {
		if (absenceTasks.length === 1 && !taskId) {
			setTaskId(absenceTasks[0]?.id ?? "");
		}
	}, [absenceTasks, taskId]);

	const span = daysBetween(from, to);
	const spanError =
		span < 0
			? "The last day is before the first."
			: span > MAX_SPAN_DAYS
				? `That's more than ${MAX_SPAN_DAYS} days — book it in two goes.`
				: null;

	const mutation = useMutation({
		mutationFn: () =>
			logAbsenceRange({
				data: {
					taskId,
					from,
					to,
					description: description.trim() || undefined,
				},
			}),
		onSuccess: async (data) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).timeEntries],
				}),
				// Absence is what the Absence tab counts and what Expected subtracts,
				// so a fortnight booked here moves both.
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).reports],
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).compliance],
				}),
			]);

			const booked = data.booked.length;
			if (data.skipped.length === 0) {
				toast.success(
					booked === 1
						? "Booked 1 day off"
						: `Booked ${booked} days off (${formatHoursShort(
								data.booked.reduce((sum, d) => sum + d.durationSeconds, 0),
							)})`,
				);
				setOpen(false);
				return;
			}
			// Something didn't land. "Booked 8, skipped 3" in a toast is the half of
			// the answer nobody can act on — which three, and why, is the half that
			// tells you whether to fix your schedule or shrug at a holiday. So the
			// dialog stays open and becomes the receipt.
			setResult(data);
		},
		onError: (error: Error) =>
			toast.error(error.message ?? "Could not book the time off"),
	});

	const bookedSeconds =
		result?.booked.reduce((sum, d) => sum + d.durationSeconds, 0) ?? 0;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={trigger} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Book time off</DialogTitle>
					<p className="text-sm text-muted-foreground">
						{result
							? "Here's what went on your timesheet."
							: "Pick the first and last day. Each working day in between is booked at your own hours — public holidays, days you don't work, and days you've already booked are left alone."}
					</p>
				</DialogHeader>

				{result ? (
					<div className="grid grid-cols-[minmax(0,1fr)] gap-4">
						<p className="text-base">
							{result.booked.length === 0
								? "Nothing was booked."
								: `Booked ${result.booked.length} ${
										result.booked.length === 1 ? "day" : "days"
									} · ${formatHoursShort(bookedSeconds)}`}
						</p>
						<div>
							<p className="text-sm text-muted-foreground">
								Skipped {result.skipped.length}{" "}
								{result.skipped.length === 1 ? "day" : "days"}
							</p>
							<div className="-mx-6 mt-2 max-h-56 divide-y divide-line2 overflow-y-auto border-y">
								{result.skipped.map((day) => (
									<div
										key={day.date}
										className="flex items-baseline justify-between gap-3 px-6 py-2"
									>
										<span className="text-sm">
											{formatDateKeyLong(day.date)}
										</span>
										<span className="shrink-0 text-xs text-muted-foreground">
											{skipReasonLabel(day.reason)}
										</span>
									</div>
								))}
							</div>
						</div>
					</div>
				) : (
					<form
						id="book-time-off"
						className="grid gap-5"
						onSubmit={(e) => {
							e.preventDefault();
							if (!taskId || spanError) return;
							mutation.mutate();
						}}
					>
						<div className="grid gap-2">
							<Label>Type</Label>
							{tasksQ.isPending ? (
								<p className="text-sm text-muted-foreground">Loading…</p>
							) : absenceTasks.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									This workspace has no absence tasks — an admin adds Vacation
									and Sick Leave in <MenuPath steps={["Settings", "Tasks"]} />.
								</p>
							) : (
								<div className="flex flex-wrap gap-1.5">
									{absenceTasks.map((t) => (
										<button
											key={t.id}
											type="button"
											onClick={() => setTaskId(t.id)}
											className={cn(
												"rounded-full border px-3 py-1.5 text-xs transition-colors duration-(--dur-fast)",
												taskId === t.id
													? "border-primary/40 bg-primary/8 font-medium text-primary"
													: "border-border text-muted-foreground hover:bg-muted",
											)}
										>
											{t.name}
										</button>
									))}
								</div>
							)}
						</div>

						<div className="flex flex-wrap items-end gap-3">
							<div className="grid min-w-40 flex-1 gap-2">
								<Label htmlFor="time-off-from">First day</Label>
								<DatePicker
									id="time-off-from"
									value={from}
									onValueChange={(next) => {
										if (!next) return;
										setFrom(next);
										// Moving the start past the end drags the end with it,
										// rather than leaving a span that reads backwards.
										if (next > to) setTo(next);
									}}
								/>
							</div>
							<div className="grid min-w-40 flex-1 gap-2">
								<Label htmlFor="time-off-to">Last day</Label>
								<DatePicker
									id="time-off-to"
									value={to}
									min={from}
									max={addDaysToKey(from, MAX_SPAN_DAYS)}
									onValueChange={(next) => next && setTo(next)}
								/>
							</div>
						</div>

						<div className="grid gap-2">
							<Label htmlFor="time-off-note">Note (optional)</Label>
							<Textarea
								id="time-off-note"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder="Anything your team should know"
							/>
						</div>

						{spanError && (
							<p className="text-sm text-destructive">{spanError}</p>
						)}

						<p className="text-sm text-muted-foreground">
							Taking half a day? Log it as a block on the timesheet instead —
							this books whole working days.
						</p>
					</form>
				)}

				<DialogFooter>
					{result ? (
						<Button onClick={() => setOpen(false)}>Done</Button>
					) : (
						<Button
							type="submit"
							form="book-time-off"
							disabled={!taskId || !!spanError || mutation.isPending}
						>
							{mutation.isPending ? "Booking…" : "Book time off"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
