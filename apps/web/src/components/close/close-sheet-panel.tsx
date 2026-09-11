import { formatDurationInput, parseDuration } from "@farmer/core/lib/time";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AbsenceEntriesDialog } from "#/components/close/absence-entries-dialog.tsx";
import { PersonCell } from "#/components/person-avatar.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { formatHoursShort } from "#/lib/format-hours.ts";
import { matchesSearch } from "#/lib/search.ts";
import { cn } from "#/lib/utils.ts";
import { closeOverviewQuery, closeSheetQuery } from "#/queries/close.ts";
import {
	finalizeClose,
	reopenClose,
	saveCloseRow,
	setCloseRowFinal,
	submitClose,
} from "#/server/close.ts";

// A cell that holds hours as free text ("7.5", "7h30m") and only commits on
// blur, so a half-typed number never round-trips to the server.
function HoursCell({
	seconds,
	placeholder,
	disabled,
	onCommit,
}: {
	seconds: number | null;
	placeholder: number;
	disabled: boolean;
	onCommit: (seconds: number | null) => void;
}) {
	const [text, setText] = useState(
		seconds == null ? "" : formatDurationInput(seconds),
	);
	useEffect(() => {
		setText(seconds == null ? "" : formatDurationInput(seconds));
	}, [seconds]);

	const commit = () => {
		const trimmed = text.trim();
		// Clearing the cell is meaningful: it drops the override so the row goes
		// back to tracking the column to its left.
		if (trimmed === "") {
			if (seconds != null) onCommit(null);
			return;
		}
		const parsed = parseDuration(trimmed);
		if (parsed == null || parsed < 0) {
			setText(seconds == null ? "" : formatDurationInput(seconds));
			return;
		}
		if (parsed === seconds) return;
		onCommit(parsed);
	};

	return (
		<Input
			className="h-8 w-20 mono text-right"
			value={text}
			disabled={disabled}
			placeholder={formatDurationInput(placeholder)}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
		/>
	);
}

// Same controlled-with-sync shape as HoursCell, for the absence-days override.
// It has to be controlled: an uncontrolled input ignores a changed defaultValue,
// so after a save-and-refetch the cell would keep showing what was typed even if
// the server stored something else.
function DaysCell({
	days,
	placeholder,
	disabled,
	onCommit,
}: {
	days: number | null;
	placeholder: number;
	disabled: boolean;
	onCommit: (days: number | null) => void;
}) {
	const [text, setText] = useState(days == null ? "" : String(days));
	useEffect(() => {
		setText(days == null ? "" : String(days));
	}, [days]);

	const commit = () => {
		const trimmed = text.trim();
		// Clearing drops the override so the row falls back to the computed value.
		if (trimmed === "") {
			if (days != null) onCommit(null);
			return;
		}
		const parsed = Number(trimmed);
		if (Number.isNaN(parsed) || parsed < 0) {
			setText(days == null ? "" : String(days));
			return;
		}
		if (parsed === days) return;
		onCommit(parsed);
	};

	return (
		<Input
			className="h-8 w-16 mono text-right"
			value={text}
			disabled={disabled}
			placeholder={String(placeholder)}
			onChange={(e) => setText(e.target.value)}
			onBlur={commit}
		/>
	);
}

function CommentCell({
	comment,
	disabled,
	onCommit,
}: {
	comment: string | null;
	disabled: boolean;
	onCommit: (comment: string) => void;
}) {
	const [text, setText] = useState(comment ?? "");
	useEffect(() => {
		setText(comment ?? "");
	}, [comment]);

	return (
		<Input
			className="h-8 min-w-40"
			value={text}
			disabled={disabled}
			placeholder="Why the change?"
			onChange={(e) => setText(e.target.value)}
			onBlur={() => {
				if (text !== (comment ?? "")) onCommit(text);
			}}
		/>
	);
}

// A variance under 5% is noise and stays quiet. Past that it takes the accent —
// the same colour every other "look at this" in the app uses. There is no
// second red: a shortfall and an overrun are both just "this moved", and the
// sign in front of the number already says which way.
const pctClass = (pct: number | null) =>
	pct == null || Math.abs(pct) < 5 ? "text-faint" : "text-primary";

export function CloseSheetPanel({
	projectId,
	year,
	month,
}: {
	projectId: string;
	year: number;
	month: number;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: sheet } = useSuspenseQuery(
		closeSheetQuery(orgSlug, { projectId, year, month }),
	);
	const [query, setQuery] = useState("");
	const rows = sheet.rows.filter((r) =>
		matchesSearch(query, [r.name, r.memberType]),
	);

	const invalidate = () =>
		Promise.all([
			queryClient.invalidateQueries({
				queryKey: closeSheetQuery(orgSlug, { projectId, year, month }).queryKey,
			}),
			queryClient.invalidateQueries({
				queryKey: closeOverviewQuery(orgSlug, { year, month }).queryKey,
			}),
		]);

	const rowMutation = useMutation({
		mutationFn: (input: {
			userId: string;
			adjustedSeconds?: number | null;
			absenceDaysOverride?: number | null;
			comment?: string;
		}) => saveCloseRow({ data: { projectId, year, month, ...input } }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	const finalMutation = useMutation({
		mutationFn: (input: { userId: string; finalSeconds: number | null }) =>
			setCloseRowFinal({ data: { projectId, year, month, ...input } }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not save"),
	});

	const transition = useMutation({
		mutationFn: (action: "submit" | "reopen" | "finalize") => {
			const data = { projectId, year, month };
			if (action === "submit") return submitClose({ data });
			if (action === "reopen") return reopenClose({ data });
			return finalizeClose({ data });
		},
		onSuccess: async (_result, action) => {
			await invalidate();
			toast.success(
				action === "submit"
					? "Submitted for finalization"
					: action === "reopen"
						? "Re-opened"
						: "Finalized",
			);
		},
		onError: (error) => toast.error(error.message ?? "Could not update status"),
	});

	// Over the whole sheet, not the rows the search left: a search narrows what
	// you look at, not what the month is invoiced at.
	const totals = sheet.rows.reduce(
		(acc, r) => ({
			reported: acc.reported + r.reportedSeconds,
			adjusted: acc.adjusted + (r.adjustedSeconds ?? r.reportedSeconds),
			final:
				acc.final + (r.finalSeconds ?? r.adjustedSeconds ?? r.reportedSeconds),
		}),
		{ reported: 0, adjusted: 0, final: 0 },
	);

	return (
		<div className="flex h-full flex-col">
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
				<div className="min-w-0">
					<p className="truncate text-base font-medium">{sheet.projectName}</p>
					<p className="truncate text-xs text-faint">{sheet.clientName}</p>
				</div>
				<div className="flex items-center gap-2">
					{sheet.rows.length > 0 && (
						<SearchInput
							value={query}
							onValueChange={setQuery}
							placeholder="Search people…"
							className="w-40 sm:w-48"
						/>
					)}
					<StatusPill
						tone={
							sheet.status === "finalized"
								? "positive"
								: sheet.status === "submitted"
									? "warning"
									: "neutral"
						}
					>
						{sheet.status === "finalized"
							? "Finalized"
							: sheet.status === "submitted"
								? "Submitted"
								: "Open"}
					</StatusPill>
					{/* A PM submits and may re-open freely before finalization; only an
					    Admin finalizes, and only an Admin re-opens afterwards. */}
					{sheet.status === "open" && sheet.canEditAdjusted && (
						<Button
							size="sm"
							disabled={transition.isPending}
							onClick={() => transition.mutate("submit")}
						>
							Submit
						</Button>
					)}
					{sheet.status !== "open" && sheet.canEditAdjusted && (
						<Button
							size="sm"
							variant="outline"
							disabled={transition.isPending}
							onClick={() => transition.mutate("reopen")}
						>
							Re-open
						</Button>
					)}
					{sheet.status !== "finalized" && sheet.canEditFinal && (
						<Button
							size="sm"
							disabled={transition.isPending}
							onClick={() => transition.mutate("finalize")}
						>
							Finalize
						</Button>
					)}
				</div>
			</div>

			<div className="scrollbar-stable min-h-0 flex-1 overflow-auto">
				<Table bleed={false}>
					<TableHeader>
						<TableRow>
							<TableHead>Person</TableHead>
							{sheet.showsExpected && (
								<TableHead className="text-right">Expected</TableHead>
							)}
							{sheet.showsExpected && (
								<TableHead className="text-right">Absence</TableHead>
							)}
							<TableHead className="text-right">Reported</TableHead>
							<TableHead className="text-right">Adjusted</TableHead>
							<TableHead className="text-right">Δ</TableHead>
							<TableHead className="text-right">Final</TableHead>
							<TableHead className="text-right">Δ</TableHead>
							<TableHead>Comment</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sheet.rows.length > 0 && rows.length === 0 && (
							<NoMatchesRow colSpan={sheet.showsExpected ? 9 : 7}>
								Nobody on this sheet matches your search.
							</NoMatchesRow>
						)}
						{rows.map((row) => (
							<TableRow key={row.userId}>
								<TableCell>
									<PersonCell userId={row.userId} name={row.name}>
										<span className="eyebrow block">{row.memberType}</span>
										{/* Org-wide for the month, not this project's share — an
									    unfiled entry has no project, so some of it may belong
									    here and there's no way to tell until they file it. Shown
									    so the PM can chase during the month; finalize refuses
									    outright while any of it is outstanding. */}
										{row.unfiledSeconds > 0 && (
											<span className="mt-0.5 block text-xs text-warn">
												{formatHoursShort(row.unfiledSeconds)} unfiled
											</span>
										)}
									</PersonCell>
								</TableCell>
								{sheet.showsExpected && (
									<TableCell className="mono text-right text-muted-foreground">
										{row.expectedSeconds == null
											? "—"
											: formatHoursShort(row.expectedSeconds)}
									</TableCell>
								)}
								{sheet.showsExpected && (
									<TableCell>
										{/* Two different answers to the same disagreement, side by
										    side on purpose. The override lives on the sheet only and
										    never writes back to entries — a gap between the two is
										    the signal that someone forgot to log their absence. The
										    button beside it opens the person's actual entries, for
										    when the PM knows the person simply never logged the week
										    and wants it fixed at the source. */}
										<span className="flex items-center justify-end gap-1">
											<DaysCell
												days={row.absenceDaysOverride}
												placeholder={row.absenceDaysComputed}
												disabled={!sheet.canEditAdjusted}
												onCommit={(absenceDaysOverride) =>
													rowMutation.mutate({
														userId: row.userId,
														absenceDaysOverride,
													})
												}
											/>
											{sheet.canEditAdjusted && (
												<AbsenceEntriesDialog
													projectId={sheet.projectId}
													year={sheet.year}
													month={sheet.month}
													userId={row.userId}
													name={row.name}
													computedDays={row.absenceDaysComputed}
												/>
											)}
										</span>
									</TableCell>
								)}
								<TableCell className="mono text-right">
									{formatHoursShort(row.reportedSeconds)}
								</TableCell>
								<TableCell className="text-right">
									<HoursCell
										seconds={row.adjustedSeconds}
										placeholder={row.reportedSeconds}
										disabled={!sheet.canEditAdjusted}
										onCommit={(adjustedSeconds) =>
											rowMutation.mutate({
												userId: row.userId,
												adjustedSeconds,
											})
										}
									/>
								</TableCell>
								<TableCell
									className={cn(
										"mono text-right text-xs",
										pctClass(row.adjustedVsReportedPct),
									)}
								>
									{row.adjustedVsReportedPct == null
										? "—"
										: `${row.adjustedVsReportedPct > 0 ? "+" : ""}${row.adjustedVsReportedPct}%`}
								</TableCell>
								<TableCell className="text-right">
									<HoursCell
										seconds={row.finalSeconds}
										placeholder={row.adjustedSeconds ?? row.reportedSeconds}
										disabled={!sheet.canEditFinal}
										onCommit={(finalSeconds) =>
											finalMutation.mutate({ userId: row.userId, finalSeconds })
										}
									/>
								</TableCell>
								<TableCell
									className={cn(
										"mono text-right text-xs",
										pctClass(row.finalVsAdjustedPct),
									)}
								>
									{row.finalVsAdjustedPct == null
										? "—"
										: `${row.finalVsAdjustedPct > 0 ? "+" : ""}${row.finalVsAdjustedPct}%`}
								</TableCell>
								<TableCell>
									<CommentCell
										comment={row.comment}
										disabled={!sheet.canEditAdjusted}
										onCommit={(comment) =>
											rowMutation.mutate({ userId: row.userId, comment })
										}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				{sheet.rows.length === 0 && (
					<p className="px-4 py-8 text-base text-muted-foreground sm:px-6">
						No one logged time on this project last month.
					</p>
				)}
			</div>

			<div className="flex shrink-0 items-baseline justify-end gap-6 border-t px-4 py-3.5 sm:px-6">
				<span className="flex items-baseline gap-2">
					<span className="eyebrow">Reported</span>
					<span className="mono text-sm">
						{formatHoursShort(totals.reported)}
					</span>
				</span>
				<span className="flex items-baseline gap-2">
					<span className="eyebrow">Adjusted</span>
					<span className="mono text-sm">
						{formatHoursShort(totals.adjusted)}
					</span>
				</span>
				<span className="flex items-baseline gap-2">
					<span className="eyebrow">Final</span>
					<span className="mono text-lg">{formatHoursShort(totals.final)}</span>
				</span>
			</div>
		</div>
	);
}
