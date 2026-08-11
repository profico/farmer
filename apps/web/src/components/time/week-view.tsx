import { parseDuration, QUARTER_HOUR_SECONDS } from "@farmer/core/lib/time";
import { NoteIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AddRowDialog,
	type DraftRow,
} from "#/components/time/add-row-dialog.tsx";
import {
	type EntryBlockRowEntry,
	entryHeading,
} from "#/components/time/entry-block-row.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { formatWeekRange } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import {
	deleteTimeEntry,
	setWeekCell,
	updateTimeEntryDescription,
} from "#/server/time-entries.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A grid row is one (project, task) pair across the whole week. */
type GridRow = {
	key: string;
	projectId: string | null;
	taskId: string;
	heading: string;
	taskName: string;
	color: string | null;
	/** The note shared by the row — taken from whichever cell has one. */
	description: string;
	/** date -> the entries behind that cell (usually exactly one). */
	byDate: Map<string, EntryBlockRowEntry[]>;
	/** True when nothing in the row may be edited from the grid. */
	locked: boolean;
};

const rowKey = (projectId: string | null, taskId: string) =>
	`${projectId ?? "none"}|${taskId}`;

/**
 * The week as an editable grid: one row per project+task, one column per day,
 * hours typed straight into the cells. This is the shape people came from in
 * Harvest and the one that actually suits a duration-only model — there is no
 * clock axis to place anything against, but "how many hours, on which day,
 * against what" is exactly a spreadsheet.
 *
 * Derived entries (fill blocks, rule-generated blocks, synced meetings) are
 * shown but not editable here: their duration comes from somewhere else, so a
 * value typed over them would be silently recomputed away. They're edited in the
 * Day view, which has the context to explain why.
 */
export function WeekView({
	orgSlug,
	dates,
	entries,
	weekStart,
	isCurrentWeek,
	holidays,
}: {
	orgSlug: string;
	dates: string[];
	entries: EntryBlockRowEntry[];
	weekStart: string;
	isCurrentWeek: boolean;
	holidays: Map<string, string>;
}) {
	const queryClient = useQueryClient();

	// Rows the user added but hasn't typed hours into yet. They have no entries
	// behind them, so they'd vanish on the next refetch without this.
	const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
	// Drafts are scaffolding for one specific week, so stepping to another week
	// has to drop them — otherwise an empty row you added to this week follows you
	// backwards and reads as time you logged then. Reset during render rather than
	// in an effect: the route reuses this component across weeks, so an effect
	// would paint the new week once with the old week's rows still in it.
	const [draftWeek, setDraftWeek] = useState(weekStart);
	if (draftWeek !== weekStart) {
		setDraftWeek(weekStart);
		setDraftRows([]);
	}

	const rowsByKey = new Map<string, GridRow>();
	for (const entry of entries) {
		const key = rowKey(entry.projectId, entry.taskId);
		let row = rowsByKey.get(key);
		if (!row) {
			row = {
				key,
				projectId: entry.projectId,
				taskId: entry.taskId,
				heading: entryHeading(entry),
				taskName: entry.project ? entry.task.name : "",
				color: entry.task.color,
				description: "",
				byDate: new Map(),
				locked: false,
			};
			rowsByKey.set(key, row);
		}
		if (!row.description && entry.description)
			row.description = entry.description;
		if (entry.fillsDay || entry.generatedFromRuleId) row.locked = true;
		const cell = row.byDate.get(entry.date);
		if (cell) cell.push(entry);
		else row.byDate.set(entry.date, [entry]);
	}
	for (const draft of draftRows) {
		if (rowsByKey.has(draft.key)) continue;
		rowsByKey.set(draft.key, {
			...draft,
			byDate: new Map(),
			locked: false,
		});
	}
	const rows = [...rowsByKey.values()].sort((a, b) =>
		a.heading.localeCompare(b.heading),
	);

	const cellSeconds = (row: GridRow, date: string) =>
		(row.byDate.get(date) ?? []).reduce((sum, e) => sum + e.durationSeconds, 0);

	const dayTotals = new Map(
		dates.map((date) => [
			date,
			entries
				.filter((e) => e.date === date)
				.reduce((sum, e) => sum + e.durationSeconds, 0),
		]),
	);
	const weekTotal = entries.reduce((sum, e) => sum + e.durationSeconds, 0);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: ["time-entries"] });

	const cellMutation = useMutation({
		mutationFn: (input: {
			date: string;
			projectId: string | null;
			taskId: string;
			durationSeconds: number;
			description: string;
		}) =>
			setWeekCell({
				data: {
					date: input.date,
					projectId: input.projectId ?? undefined,
					taskId: input.taskId,
					durationSeconds: input.durationSeconds,
					description: input.description || undefined,
				},
			}),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	const removeRow = useMutation({
		mutationFn: async (row: GridRow) => {
			for (const cell of row.byDate.values()) {
				for (const entry of cell) {
					await deleteTimeEntry({ data: entry.id });
				}
			}
		},
		onSuccess: async (_result, row) => {
			setDraftRows((current) => current.filter((d) => d.key !== row.key));
			await invalidate();
		},
		onError: (error) => toast.error(error.message ?? "Could not remove row"),
	});

	return (
		<div className="flex h-full flex-col">
			<TimeToolbar
				add={
					<AddRowDialog
						existingKeys={new Set(rows.map((r) => r.key))}
						onAdd={(row) => setDraftRows((current) => [...current, row])}
						trigger={
							<Button size="icon" aria-label="Add row">
								<PlusIcon weight="regular" className="size-4" />
							</Button>
						}
					/>
				}
				prev={
					<Link
						to="/$orgSlug/time/week"
						params={{ orgSlug }}
						search={{ weekStart: shiftWeek(weekStart, -7) }}
						className={stepperClass}
						aria-label="Previous week"
					>
						←
					</Link>
				}
				label={formatWeekRange(dates[0] ?? "", dates[dates.length - 1] ?? "")}
				next={
					<Link
						to="/$orgSlug/time/week"
						params={{ orgSlug }}
						search={{ weekStart: shiftWeek(weekStart, 7) }}
						className={stepperClass}
						aria-label="Next week"
					>
						→
					</Link>
				}
				returnLink={
					!isCurrentWeek && (
						<Link
							to="/$orgSlug/time/week"
							params={{ orgSlug }}
							search={{}}
							className={returnLinkClass}
						>
							Return to this week
						</Link>
					)
				}
			/>

			{/* Gutter reserved: the table's columns are percentage-width, so a week
			    that overflows and one that doesn't would lay them out 10px apart
			    and shift every column on each navigation. */}
			<div className="scrollbar-stable -mx-4 mt-5 min-h-0 flex-1 overflow-auto sm:-mx-8">
				<table className="w-full min-w-[900px] border-collapse">
					<thead>
						<tr className="border-b">
							<th className="w-[34%] px-4 py-2 text-left sm:pl-8" />
							<th className="w-10" />
							{dates.map((date) => {
								const holidayName = holidays.get(date);
								return (
									<th key={date} className="px-1 py-2 text-center font-normal">
										<Link
											to="/$orgSlug/time"
											params={{ orgSlug }}
											search={{ date }}
											title={holidayName}
											className="group block"
										>
											<span className="eyebrow block">
												{
													WEEKDAY_LABELS[
														new Date(`${date}T12:00:00Z`).getUTCDay()
													]
												}
											</span>
											<span
												className={cn(
													"mono mt-1 block text-sm group-hover:text-primary",
													holidayName && "text-warn",
												)}
											>
												{Number(date.slice(-2))}
											</span>
										</Link>
									</th>
								);
							})}
							<th className="eyebrow px-3 py-2 text-right sm:pr-8">Total</th>
							<th className="w-8" />
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => {
							const rowTotal = dates.reduce(
								(sum, date) => sum + cellSeconds(row, date),
								0,
							);
							return (
								<tr
									key={row.key}
									className="border-b border-line2 transition-colors duration-(--dur-fast) hover:bg-[var(--sel)]"
								>
									<td className="px-4 py-2 sm:pl-8">
										<div className="flex items-start gap-2">
											<span
												className="mt-1.5 size-2 shrink-0 rounded-full"
												style={{
													backgroundColor:
														row.color ?? "var(--muted-foreground)",
												}}
											/>
											<div className="min-w-0">
												<p className="truncate text-base font-medium">
													{row.heading}
												</p>
												{row.taskName && (
													<p className="truncate text-sm text-muted-foreground">
														{row.taskName}
													</p>
												)}
											</div>
										</div>
									</td>
									<td className="px-1 py-2">
										<RowNoteDialog
											heading={row.heading}
											dates={dates}
											byDate={row.byDate}
											hasNote={Boolean(row.description)}
											disabled={row.locked}
											onSave={async (notesByDate) => {
												// Each day's note goes onto that day's entries only.
												for (const [date, description] of notesByDate) {
													for (const entry of row.byDate.get(date) ?? []) {
														await updateTimeEntryDescription({
															data: { timeEntryId: entry.id, description },
														});
													}
												}
												await invalidate();
											}}
										/>
									</td>
									{dates.map((date) => (
										<td key={date} className="px-1 py-2">
											<GridCell
												seconds={cellSeconds(row, date)}
												disabled={row.locked}
												// A row with nothing logged anywhere is one you just
												// added and are about to type into, so its cells keep
												// their outlines. Dropping them made an empty week's
												// new row read as a blank strip with no indication of
												// where — or whether — you could type.
												outlined={row.byDate.size === 0}
												onCommit={(durationSeconds) =>
													cellMutation.mutate({
														date,
														projectId: row.projectId,
														taskId: row.taskId,
														durationSeconds,
														description: row.description,
													})
												}
											/>
										</td>
									))}
									<td className="mono px-3 py-2 text-right text-sm sm:pr-8">
										{rowTotal > 0 ? (
											formatClock(rowTotal)
										) : (
											<span className="text-faint">—</span>
										)}
									</td>
									<td className="pr-2">
										{!row.locked && (
											<button
												type="button"
												aria-label={`Remove ${row.heading}`}
												className="flex size-6 items-center justify-center rounded-md text-faint transition-colors duration-(--dur-fast) hover:bg-muted hover:text-primary"
												disabled={removeRow.isPending}
												onClick={() => removeRow.mutate(row)}
											>
												<XIcon weight="regular" className="size-3.5" />
											</button>
										)}
									</td>
								</tr>
							);
						})}
						{rows.length === 0 && (
							<tr>
								<td colSpan={dates.length + 4} className="px-4 py-10 sm:px-8">
									<p className="h2">Nothing logged this week</p>
									<p className="lede mt-2">Add a row to start filling it in.</p>
								</td>
							</tr>
						)}
					</tbody>
					<tfoot>
						<tr>
							<td className="px-4 py-3.5 sm:pl-8" />
							<td />
							{dates.map((date) => (
								<td key={date} className="mono px-1 py-3.5 text-center text-sm">
									{formatClock(dayTotals.get(date) ?? 0)}
								</td>
							))}
							<td className="mono px-3 py-3.5 text-right text-md sm:pr-8">
								{formatClock(weekTotal)}
							</td>
							<td />
						</tr>
					</tfoot>
				</table>
			</div>

			{/* Bleeds to the island's edge like the grid above it — this rule used to
			    stop at the padding while the table's did not. Same footer geometry
			    as Day, so stepping between the two tabs doesn't move the rule. */}
			<div className="-mx-4 -mb-4 flex h-(--footer-h) shrink-0 items-center gap-2 border-t px-4 sm:-mx-8 sm:-mb-7 sm:px-8">
				<AddRowDialog
					existingKeys={new Set(rows.map((r) => r.key))}
					onAdd={(row) => setDraftRows((current) => [...current, row])}
					trigger={
						<Button variant="outline" size="sm">
							<PlusIcon weight="regular" className="size-4" />
							Add row
						</Button>
					}
				/>
			</div>
		</div>
	);
}

/** One editable hours box. Free text in, 15-minute steps out. */
function GridCell({
	seconds,
	disabled,
	outlined = false,
	onCommit,
}: {
	seconds: number;
	disabled: boolean;
	/** Keep the outline even when empty — see the call site. */
	outlined?: boolean;
	onCommit: (seconds: number) => void;
}) {
	const [text, setText] = useState(seconds > 0 ? formatClock(seconds) : "");
	const [focused, setFocused] = useState(false);
	// Never overwrite what someone is mid-way through typing; sync only while the
	// cell is idle. (The cell deliberately does NOT reformat on focus either —
	// rewriting the value under a cursor that just landed there loses the first
	// keystroke of a click-and-type, and H:MM parses back anyway.)
	useEffect(() => {
		if (!focused) setText(seconds > 0 ? formatClock(seconds) : "");
	}, [seconds, focused]);

	const commit = () => {
		setFocused(false);
		const trimmed = text.trim();
		if (trimmed === "") {
			// An emptied box means "remove this", not "leave it alone".
			if (seconds > 0) onCommit(0);
			else setText("");
			return;
		}
		const parsed = parseDuration(trimmed);
		if (parsed == null || parsed < 0) {
			setText(seconds > 0 ? formatClock(seconds) : "");
			return;
		}
		const snapped =
			Math.round(parsed / QUARTER_HOUR_SECONDS) * QUARTER_HOUR_SECONDS;
		if (snapped === seconds) {
			setText(seconds > 0 ? formatClock(seconds) : "");
			return;
		}
		onCommit(snapped);
	};

	return (
		<Input
			className={cn(
				"mono h-8 w-full min-w-16 px-1.5 text-center text-sm",
				// An empty cell drops its outline. Seven days × N rows of visible
				// boxes is a grid of empty rectangles that reads as the content;
				// the hairline comes back the moment you point at one, which is
				// the only moment it says anything. `outlined` opts out, for a row
				// that has no filled cells to give it shape in the first place.
				seconds === 0 && "text-faint",
				seconds === 0 &&
					!outlined &&
					"border-transparent hover:not-disabled:border-border",
			)}
			inputMode="decimal"
			disabled={disabled}
			value={text}
			title={
				disabled
					? "Generated automatically — edit it in the Day view"
					: undefined
			}
			onFocus={() => setFocused(true)}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") e.currentTarget.blur();
				if (e.key === "Escape") {
					setFocused(false);
					setText(seconds > 0 ? formatClock(seconds) : "");
					e.currentTarget.blur();
				}
			}}
		/>
	);
}

/**
 * The row's notes, one box per day you actually logged against it.
 *
 * This used to be a single textarea whose text was written onto every entry in
 * the row at once, which made "what did you do on this project this week?"
 * answerable only in the aggregate — Tuesday's note overwrote Monday's the
 * moment you saved. A note describes a day's work, so a day gets its own box.
 *
 * Only days with hours get one: a description is stored on a time entry, so
 * there is nothing for a note on an empty day to attach to.
 */
function RowNoteDialog({
	heading,
	dates,
	byDate,
	hasNote,
	disabled,
	onSave,
}: {
	heading: string;
	/** The week's seven day keys, in order. */
	dates: string[];
	byDate: Map<string, EntryBlockRowEntry[]>;
	/** Whether any day in the row carries a note, for the trigger's state. */
	hasNote: boolean;
	disabled: boolean;
	/** date -> the note to write onto every entry on that date. */
	onSave: (notesByDate: Map<string, string>) => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	// Only the days this row has entries on are editable.
	const loggedDates = dates.filter(
		(date) => (byDate.get(date) ?? []).length > 0,
	);

	// The note currently stored for a day — taken from whichever of its entries
	// has one, matching how a day's entries are treated as a single block here.
	const storedNote = (date: string) =>
		(byDate.get(date) ?? []).find((e) => e.description)?.description ?? "";

	const [drafts, setDrafts] = useState<Record<string, string>>({});
	// Reset the draft state each time the dialog opens, so a cancelled edit
	// doesn't survive into the next open.
	const [wasOpen, setWasOpen] = useState(false);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setDrafts(Object.fromEntries(loggedDates.map((d) => [d, storedNote(d)])));
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<button
						type="button"
						aria-label={`Notes for ${heading}`}
						disabled={disabled}
						className={cn(
							"flex size-7 items-center justify-center rounded-md border transition-colors duration-(--dur-fast)",
							hasNote
								? "border-border text-foreground"
								: "border-dashed text-faint",
							!disabled && "hover:bg-muted hover:text-foreground",
							disabled && "opacity-40",
						)}
					>
						<NoteIcon className="size-3.5" />
					</button>
				}
			/>
			{/* Height cap, body scroll and sticky footer are DialogContent's job now
			    (see dialog.tsx) — a full week of boxes is taller than a short
			    viewport, and this dialog is only wider than default. */}
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{heading}</DialogTitle>
				</DialogHeader>

				{loggedDates.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Nothing logged on this row yet. Enter hours on a day first — a note
						is saved onto the entry for that day.
					</p>
				) : (
					<div className="space-y-4">
						{loggedDates.map((date, i) => {
							const seconds = (byDate.get(date) ?? []).reduce(
								(sum, e) => sum + e.durationSeconds,
								0,
							);
							return (
								<div key={date}>
									<label
										htmlFor={`note-${date}`}
										className="flex items-baseline justify-between gap-2"
									>
										<span className="eyebrow">
											{
												WEEKDAY_LABELS[
													new Date(`${date}T12:00:00Z`).getUTCDay()
												]
											}{" "}
											{Number(date.slice(-2))}
										</span>
										<span className="mono text-sm text-muted-foreground">
											{formatClock(seconds)}
										</span>
									</label>
									<Textarea
										id={`note-${date}`}
										// Focus lands on the first day rather than the dialog, so
										// typing starts where the reading does.
										autoFocus={i === 0}
										rows={2}
										className="mt-1.5 resize-y"
										value={drafts[date] ?? ""}
										onChange={(e) =>
											setDrafts((current) => ({
												...current,
												[date]: e.target.value,
											}))
										}
										placeholder="What you did"
									/>
								</div>
							);
						})}
					</div>
				)}

				<DialogFooter>
					<Button
						disabled={saving || loggedDates.length === 0}
						onClick={async () => {
							setSaving(true);
							try {
								// Only send the days whose text actually changed, so opening
								// and saving the dialog doesn't rewrite every entry in the row.
								const changed = new Map<string, string>();
								for (const date of loggedDates) {
									const next = (drafts[date] ?? "").trim();
									if (next !== storedNote(date)) changed.set(date, next);
								}
								if (changed.size > 0) await onSave(changed);
								setOpen(false);
							} finally {
								setSaving(false);
							}
						}}
					>
						{saving ? "Saving…" : "Save notes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** Pure string math on a day key — a week shift never crosses a timezone. */
function shiftWeek(weekStart: string, days: number): string {
	const date = new Date(`${weekStart}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
