import {
	addDaysToKey,
	parseDuration,
	snapToQuarterHour,
	startOfWeekKey,
} from "@farmer/core/lib/time";
import {
	ArrowLeftIcon,
	ArrowRightIcon,
	NoteIcon,
	PlusIcon,
	UmbrellaSimpleIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
	AddRowDialog,
	type DraftRow,
} from "#/components/time/add-row-dialog.tsx";
import { BookTimeOffDialog } from "#/components/time/book-time-off-dialog.tsx";
import {
	type EntryBlockRowEntry,
	entryHeading,
} from "#/components/time/entry-block-row.tsx";
import { EntryMark } from "#/components/time/entry-mark.tsx";
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
import { useWeekStartsOn } from "#/hooks/use-week-starts-on.ts";
import { formatWeekRange } from "#/lib/format-date.ts";
import { formatClock } from "#/lib/format-hours.ts";
import { cn } from "#/lib/utils.ts";
import { queryKeys } from "#/queries/keys.ts";
import { timeEntriesRangeQuery } from "#/queries/time-entries.ts";
import {
	copyTimeEntriesWeek,
	deleteTimeEntry,
	setWeekCell,
	updateTimeEntryDescription,
} from "#/server/time-entries.ts";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Tue 11" — the day as the column header shows it, for a cell's accessible
 *  name. A `<th>` alone would not do it: a screen reader announces the column
 *  header for a `<td>`, not for the input inside it. */
const dayLabel = (date: string) =>
	`${WEEKDAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${Number(
		date.slice(-2),
	)}`;

/** A grid row is one (project, task) pair across the whole week. */
type GridRow = {
	key: string;
	projectId: string | null;
	taskId: string;
	heading: string;
	taskName: string;
	color: string | null;
	/** The row's project, for its icon; null on a project-less row. */
	project: { name: string; icon?: string | null } | null;
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
	const navigate = useNavigate();
	const weekStartsOn = useWeekStartsOn();

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
				project: entry.project,
				byDate: new Map(),
				locked: false,
			};
			rowsByKey.set(key, row);
		}
		if (entry.fillsDay || entry.generatedFromRuleId) row.locked = true;
		const cell = row.byDate.get(entry.date);
		if (cell) cell.push(entry);
		else row.byDate.set(entry.date, [entry]);
	}
	for (const draft of draftRows) {
		if (rowsByKey.has(draft.key)) continue;
		rowsByKey.set(draft.key, {
			key: draft.key,
			projectId: draft.projectId,
			taskId: draft.taskId,
			heading: draft.heading,
			taskName: draft.taskName,
			color: draft.color,
			project: draft.project,
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
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).timeEntries],
		});

	// Cell-to-cell keyboard movement. Scoped to this table's own node rather than
	// the document, so a second grid on the page could never be walked into, and
	// resolved by query at the moment of the move: rows re-sort as work is logged,
	// so a map of refs built at render time would be stale by the time it is read.
	const gridRef = useRef<HTMLTableElement>(null);
	const moveFocus = (fromRow: number, colIndex: number, step: 1 | -1) => {
		// A derived row's cells are disabled and cannot take focus, so step over
		// them in the direction of travel rather than stalling on one. Bounded by
		// the row count: past either end the move is simply a no-op, which is what
		// arrow keys do at the edge of any grid.
		for (let i = fromRow + step; i >= 0 && i < rows.length; i += step) {
			const cell = gridRef.current?.querySelector<HTMLInputElement>(
				`[data-grid-cell="${i}:${colIndex}"]`,
			);
			if (cell && !cell.disabled) {
				cell.focus();
				cell.select();
				return;
			}
		}
	};

	const cellMutation = useMutation({
		mutationFn: (input: {
			date: string;
			projectId: string | null;
			taskId: string;
			durationSeconds: number;
		}) =>
			// No description, ever. `setWeekCell` reads an absent one as "leave the
			// note alone", so a cell write can only ever change the hours.
			setWeekCell({
				data: {
					date: input.date,
					projectId: input.projectId ?? undefined,
					taskId: input.taskId,
					durationSeconds: input.durationSeconds,
				},
			}),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	const copyWeek = useMutation({
		mutationFn: () =>
			copyTimeEntriesWeek({
				data: {
					fromWeekStart: shiftWeek(weekStart, -7),
					toWeekStart: weekStart,
				},
			}),
		onSuccess: async (result) => {
			await invalidate();
			// Three outcomes worth telling apart: nothing to copy, everything was
			// already here (a second click), and some days refused because copying
			// would have pushed them past 24 hours.
			const parts: string[] = [];
			if (result.copied > 0) {
				parts.push(
					`Copied ${result.copied} ${result.copied === 1 ? "entry" : "entries"}`,
				);
			}
			if (result.skipped > 0) parts.push(`${result.skipped} already here`);
			if (result.blockedDays.length > 0) {
				parts.push(
					`${result.blockedDays.length} ${
						result.blockedDays.length === 1 ? "day" : "days"
					} would exceed 24 hours`,
				);
			}
			if (parts.length === 0) {
				toast.success("Nothing to copy from last week");
			} else if (result.blockedDays.length > 0) {
				toast.warning(parts.join(", "));
			} else {
				toast.success(parts.join(", "));
			}
		},
		onError: (error) => toast.error(error.message ?? "Could not copy the week"),
	});

	/* Optimistic: the row leaves the grid on the press, and comes back with a
	   toast if the server refuses. It used to wait for one delete per entry,
	   one after another, and then the refetch — seconds on a full row, behind a
	   button that did not look any different while it waited. The days go in
	   parallel; a day's own entries stay in order, because each delete
	   recomputes that day's fill block.

	   Every day is waited for before a failure is thrown. `Promise.all` threw
	   on the first one while the other days were still deleting, so the
	   rollback and the refetch ran against a server that had not finished,
	   and the grid kept a total that a reload did not show. */
	const removeRow = useMutation({
		mutationFn: async (row: GridRow) => {
			const days = await Promise.allSettled(
				[...row.byDate.values()].map(async (cell) => {
					for (const entry of cell) {
						await deleteTimeEntry({ data: entry.id });
					}
				}),
			);
			const failed = days.find((day) => day.status === "rejected");
			if (failed) throw failed.reason;
		},
		onMutate: async (row) => {
			const { queryKey } = timeEntriesRangeQuery(
				orgSlug,
				weekStart,
				addDaysToKey(weekStart, 6),
			);
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			const previousDrafts = draftRows;
			const ids = new Set(
				[...row.byDate.values()].flatMap((cell) => cell.map((e) => e.id)),
			);
			queryClient.setQueryData(queryKey, (old) =>
				old?.filter((entry) => !ids.has(entry.id)),
			);
			setDraftRows((current) => current.filter((d) => d.key !== row.key));
			return { queryKey, previous, previousDrafts };
		},
		onError: (error, _row, context) => {
			if (context) {
				queryClient.setQueryData(context.queryKey, context.previous);
				setDraftRows(context.previousDrafts);
			}
			toast.error(error.message ?? "Could not remove row");
		},
		// A delete moves the day's fill block and the targets, which only the
		// server can answer — and a partial failure leaves some entries gone.
		onSettled: invalidate,
	});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
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
						<ArrowLeftIcon weight="regular" className="size-4" />
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
						<ArrowRightIcon weight="regular" className="size-4" />
					</Link>
				}
				jumpTo={{
					value: weekStart,
					// Any day in a week identifies that week, so the picker snaps to
					// the day its week starts on rather than refusing a mid-week date.
					onPick: (picked) =>
						navigate({
							to: "/$orgSlug/time/week",
							params: { orgSlug },
							search: { weekStart: startOfWeekKey(picked, weekStartsOn) },
						}),
				}}
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
			>
				<BookTimeOffDialog
					orgSlug={orgSlug}
					defaultDate={weekStart}
					trigger={
						<Button variant="outline" size="sm">
							<UmbrellaSimpleIcon className="size-4" />
							Time off
						</Button>
					}
				/>
			</TimeToolbar>

			{/* Gutter reserved: the table's columns are percentage-width, so a week
			    that overflows and one that doesn't would lay them out 10px apart
			    and shift every column on each navigation. */}
			<div className="scrollbar-stable -mx-4 mt-5 min-h-0 flex-1 overflow-auto sm:-mx-8">
				<table ref={gridRef} className="w-full min-w-[900px] border-collapse">
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
						{rows.map((row, rowIndex) => {
							const rowTotal = dates.reduce(
								(sum, date) => sum + cellSeconds(row, date),
								0,
							);
							const saveRowNotes = async (notesByDate: Map<string, string>) => {
								// Each day's note goes onto that day's entries only.
								for (const [date, description] of notesByDate) {
									for (const entry of row.byDate.get(date) ?? []) {
										await updateTimeEntryDescription({
											data: { timeEntryId: entry.id, description },
										});
									}
								}
								await invalidate();
							};
							return (
								<tr
									key={row.key}
									className="border-b border-line2 transition-colors duration-(--dur-fast) hover:bg-[var(--sel)]"
								>
									<td className="px-4 py-2 sm:pl-8">
										<div className="flex items-start gap-2">
											<EntryMark
												project={row.project}
												taskColor={row.color}
												className="mt-0.5"
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
									{/* The note button appears only once the row has hours. An
									    empty row is scaffolding — a note is stored on a time
									    entry, so until one exists there is nothing to write it
									    on. The cell keeps the button's footprint so adding the
									    first hours doesn't shift the grid sideways. */}
									<td className="px-1 py-2">
										{rowTotal === 0 ? (
											<span className="block size-7" aria-hidden />
										) : (
											<RowNoteDialog
												heading={row.heading}
												dates={dates}
												byDate={row.byDate}
												hasNote={dates.some((date) =>
													(row.byDate.get(date) ?? []).some(
														(e) => e.description,
													),
												)}
												onSave={saveRowNotes}
											/>
										)}
									</td>
									{dates.map((date, colIndex) => {
										const dayEntries = row.byDate.get(date) ?? [];
										const cellHasNote = dayEntries.some((e) => e.description);
										return (
											<td key={date} className="px-1 py-2">
												<div className="relative">
													<GridCell
														seconds={cellSeconds(row, date)}
														disabled={row.locked}
														rowIndex={rowIndex}
														colIndex={colIndex}
														onMove={moveFocus}
														label={`${row.heading}${
															row.taskName ? ` — ${row.taskName}` : ""
														}, ${dayLabel(date)}`}
														lockedReason={
															row.locked
																? "Generated automatically — edit it in the Day view"
																: undefined
														}
														// Hours only: a cell write says how long you worked and
														// nothing about what you did. Notes are edited via the
														// note dialog triggers (row-level button or the per-cell
														// icon inside the grid).
														// Passing one here is what used to overwrite Thursday's
														// note with Monday's every time hours were corrected.
														onCommit={(durationSeconds) =>
															cellMutation.mutate({
																date,
																projectId: row.projectId,
																taskId: row.taskId,
																durationSeconds,
															})
														}
													/>
													{rowTotal === 0 ? null : (
														<div className="absolute left-1 top-1/2 z-10 -translate-y-1/2">
															<DayNoteDialog
																heading={row.heading}
																date={date}
																entries={dayEntries}
																hasNote={cellHasNote}
																onSave={async (description) =>
																	saveRowNotes(
																		new Map<string, string>([
																			[date, description],
																		]),
																	)
																}
																contentClassName="sm:max-w-sm"
																trigger={({ hasNote }) => (
																	<button
																		type="button"
																		aria-label={`Notes for ${row.heading} on ${date}`}
																		className={cn(
																			"flex size-5 items-center justify-center rounded-md border bg-background/80 shadow-sm backdrop-blur transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground",
																			hasNote
																				? "border-primary/40 text-primary"
																				: "border-border text-faint",
																		)}
																	>
																		<NoteIcon className="size-3.5" />
																	</button>
																)}
															/>
														</div>
													)}
												</div>
											</td>
										);
									})}
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
												className="flex size-6 items-center justify-center rounded-md text-faint transition-colors duration-(--dur-fast) hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
												// One removal at a time: two at once each snapshot,
												// roll back and refetch over the other's optimistic
												// state, so a removed row came back.
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
				{/* Day has had this since the beginning; a week whose shape repeats is
				    the more common case, and the one Harvest offers it for. */}
				<Button
					variant="outline"
					size="sm"
					disabled={copyWeek.isPending}
					onClick={() => copyWeek.mutate()}
				>
					{copyWeek.isPending ? "Copying…" : "Copy from previous week"}
				</Button>
			</div>
		</div>
	);
}

/**
 * One editable hours box. Free text in, 15-minute steps out.
 *
 * Two things it is deliberately not: a bare `<input>` with no accessible name
 * (it announced "edit text, blank", with no way to tell which project or which
 * day you had landed on), and a box you can only find with a pointer (empty
 * cells used to drop their border entirely and get it back on hover, which is
 * exactly backwards — the days you have NOT filled in are the ones you are
 * looking for, and on a touch screen there is no hover to find them with).
 */
function GridCell({
	seconds,
	disabled,
	label,
	lockedReason,
	rowIndex,
	colIndex,
	onMove,
	onCommit,
}: {
	seconds: number;
	disabled: boolean;
	/** What this box IS, for a screen reader: the row's work and the day. */
	label: string;
	/** Why it cannot be edited here, if it cannot. Part of the accessible name
	 *  rather than a `title` tooltip, which no keyboard user ever sees. */
	lockedReason?: string;
	rowIndex: number;
	colIndex: number;
	/** Move focus one cell up or down this column — the grid's job, since only it
	 *  knows the shape and which rows are editable. */
	onMove: (fromRow: number, colIndex: number, step: 1 | -1) => void;
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
		// A literal "0" is the other way to clear a cell, so it stays 0. Anything
		// else goes through the shared snap, which floors at 15 minutes — the local
		// `Math.round(parsed / 900) * 900` this replaces turned a typed "0.1" into
		// 0, which the cell then read as "delete this row".
		const snapped = parsed === 0 ? 0 : snapToQuarterHour(parsed);
		if (snapped === seconds) {
			setText(seconds > 0 ? formatClock(seconds) : "");
			return;
		}
		onCommit(snapped);
	};

	return (
		<Input
			className={cn(
				"mono h-8 w-full min-w-20 pl-6 pr-2 text-center text-sm",
				// An empty cell is quieter than a filled one, but it is still a box.
				// Seven days × N rows of full-strength outlines reads as the content
				// rather than the frame, so the border thins out — it does not
				// disappear, which is what made the grid unfindable without a mouse.
				seconds === 0 && "border-line2 text-faint",
			)}
			inputMode="decimal"
			disabled={disabled}
			value={text}
			data-grid-cell={`${rowIndex}:${colIndex}`}
			aria-label={lockedReason ? `${label} — ${lockedReason}` : label}
			aria-readonly={disabled || undefined}
			title={lockedReason}
			onFocus={() => setFocused(true)}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				// Enter commits and steps DOWN, the spreadsheet convention — it used
				// to just blur, which left you with no keyboard way out of a cell
				// except Tab, and Tab runs along the row through the note and delete
				// buttons. Filling one day down a column took ten presses per row.
				if (e.key === "Enter") {
					e.currentTarget.blur();
					onMove(rowIndex, colIndex, 1);
					return;
				}
				// Up/Down only. Left/Right stay bound to the caret, which is what
				// anyone typing into a text box expects them to do.
				//
				// No explicit blur here, unlike Enter: focusing the next cell blurs
				// this one on its own, and so commits it. Blurring first would mean
				// that at the top and bottom rows — where there is no next cell —
				// the arrow key threw you out of the grid instead of doing nothing.
				if (e.key === "ArrowUp" || e.key === "ArrowDown") {
					e.preventDefault();
					onMove(rowIndex, colIndex, e.key === "ArrowDown" ? 1 : -1);
					return;
				}
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
 * there is nothing for a note on an empty day to attach to. The trigger itself
 * is hidden until the row has hours, for the same reason — but the empty case
 * is still handled here, because the last entry in a row can be cleared from
 * another tab while this dialog is open.
 */
function RowNoteDialog({
	heading,
	dates,
	byDate,
	hasNote,
	onSave,
	trigger,
	contentClassName,
}: {
	heading: string;
	/** The week's seven day keys, in order. */
	dates: string[];
	byDate: Map<string, EntryBlockRowEntry[]>;
	/** Whether any day in the row carries a note, for the trigger's state. */
	hasNote: boolean;
	/** date -> the note to write onto every entry on that date. */
	onSave: (notesByDate: Map<string, string>) => Promise<void>;
	/**
	 * Optional trigger override, used to place the note icon inside other UI.
	 * If omitted, the original row-footprint button is rendered.
	 */
	trigger?: (args: { hasNote: boolean }) => ReactNode;
	/** Allows a smaller popup when used inline inside grid cells. */
	contentClassName?: string;
}) {
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	const defaultTrigger = ({ hasNote }: { hasNote: boolean }) => (
		<button
			type="button"
			aria-label={`Notes for ${heading}`}
			className={cn(
				"flex size-7 items-center justify-center rounded-md border transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground",
				hasNote ? "border-border text-foreground" : "border-dashed text-faint",
			)}
		>
			<NoteIcon className="size-3.5" />
		</button>
	);

	const triggerNode = (trigger ?? defaultTrigger)({ hasNote });

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
			{/* SAFETY: Base UI's `render` prop is typed against the element it
			    composes with, and this trigger is whatever JSX the caller passed
			    in. `never` is the escape Base UI's own docs use for a
			    caller-provided node. */}
			<DialogTrigger
				render={
					// SAFETY: Base UI's `render` prop is typed against the element it
					// composes with, and this trigger is whatever JSX the caller passed
					// in. `never` is the escape Base UI's own docs use for a
					// caller-provided node.
					triggerNode as never
				}
			/>
			{/* Height cap, body scroll and sticky footer are DialogContent's job now
			    (see dialog.tsx) — a full week of boxes is taller than a short
			    viewport, and this dialog is only wider than default. */}
			<DialogContent className={contentClassName ?? "sm:max-w-lg"}>
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

/**
 * Notes for a single day inside the week grid.
 *
 * This is the "singular" version of `RowNoteDialog`: it edits only the
 * `entries` that exist for `date`, instead of showing one textarea per day
 * in the row.
 */
function DayNoteDialog({
	heading,
	date,
	entries,
	hasNote,
	onSave,
	trigger,
	contentClassName,
}: {
	heading: string;
	date: string;
	entries: EntryBlockRowEntry[];
	hasNote: boolean;
	onSave: (description: string) => Promise<void>;
	trigger?: (args: { hasNote: boolean }) => ReactNode;
	contentClassName?: string;
}) {
	const [open, setOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	const storedNote = entries.find((e) => e.description)?.description ?? "";
	const [draft, setDraft] = useState(storedNote);

	const seconds = entries.reduce((sum, e) => sum + e.durationSeconds, 0);

	const [wasOpen, setWasOpen] = useState(false);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) setDraft(storedNote);
	}

	const defaultTrigger = ({ hasNote }: { hasNote: boolean }) => (
		<button
			type="button"
			aria-label={`Notes for ${heading} on ${date}`}
			className={cn(
				"flex size-7 items-center justify-center rounded-md border transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground",
				hasNote ? "border-primary/40 text-primary" : "border-dashed text-faint",
			)}
		>
			<NoteIcon className="size-3.5" />
		</button>
	);

	const triggerNode = (trigger ?? defaultTrigger)({ hasNote });

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			{/* SAFETY: Base UI's `render` prop is typed against the element it
			    composes with, and this trigger is whatever JSX the caller passed
			    in. `never` is the escape Base UI's own docs use for a
			    caller-provided node. */}
			<DialogTrigger
				render={
					// SAFETY: Base UI's `render` prop is typed against the element it
					// composes with, and this trigger is whatever JSX the caller passed
					// in. `never` is the escape Base UI's own docs use for a
					// caller-provided node.
					triggerNode as never
				}
			/>
			<DialogContent className={contentClassName ?? "sm:max-w-sm"}>
				<DialogHeader>
					<DialogTitle>{heading}</DialogTitle>
				</DialogHeader>

				{entries.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Nothing logged on this day yet. Enter hours first — a note can only
						be attached to existing entries.
					</p>
				) : (
					<div className="space-y-3">
						<div className="flex items-baseline justify-between gap-3">
							<span className="eyebrow">
								{WEEKDAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()]}{" "}
								{Number(date.slice(-2))}
							</span>
							<span className="mono text-sm text-muted-foreground">
								{formatClock(seconds)}
							</span>
						</div>

						<Textarea
							id={`note-${date}-single`}
							autoFocus
							rows={3}
							className="resize-y"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							placeholder="What you did"
						/>
					</div>
				)}

				<DialogFooter>
					<Button
						disabled={
							saving ||
							entries.length === 0 ||
							draft.trimEnd() === storedNote.trimEnd()
						}
						onClick={async () => {
							setSaving(true);
							try {
								await onSave(draft.trimEnd());
								setOpen(false);
							} finally {
								setSaving(false);
							}
						}}
					>
						{saving ? "Saving…" : "Save note"}
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
