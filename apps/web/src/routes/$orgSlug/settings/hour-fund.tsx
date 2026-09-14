import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import {
	returnLinkClass,
	stepperClass,
	TimeToolbar,
} from "#/components/time/time-toolbar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { hourFundYearQuery } from "#/queries/hour-fund.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import {
	clearMonthlyHourFund,
	prefillHourFundYear,
	setMonthlyHourFund,
} from "#/server/hour-fund.ts";

const searchSchema = z.object({
	year: z.number().int().min(2000).max(2100).optional(),
});

export const Route = createFileRoute("/$orgSlug/settings/hour-fund")({
	validateSearch: searchSchema,
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loaderDeps: ({ search }) => ({ year: search.year }),
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const year = deps.year ?? new Date().getUTCFullYear();
		await context.queryClient.ensureQueryData(hourFundYearQuery(orgSlug, year));
	},
	component: HourFundPage,
});

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, i) => i + 1);
const MONTHS = Array.from({ length: 12 }, (_, i) =>
	new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(2000, i, 15)),
	),
);

function MonthRow({
	year,
	month,
	fundSeconds,
}: {
	year: number;
	month: number;
	fundSeconds: number | null;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const asText = fundSeconds == null ? "" : String(fundSeconds / 3600);
	const [text, setText] = useState(asText);

	// Re-sync when the row's fund changes underneath us — which is what "Prefill
	// from calendar" does to all twelve rows at once. `useState` only reads its
	// argument on mount and the row's key doesn't change, so without this the
	// prefill wrote twelve funds to the database and every input still showed
	// empty: the button looked like it had done nothing at all.
	//
	// The store-the-previous-prop form rather than an effect, so the corrected
	// value is in the same render as the new prop instead of a frame behind it.
	const [lastFundSeconds, setLastFundSeconds] = useState(fundSeconds);
	if (fundSeconds !== lastFundSeconds) {
		setLastFundSeconds(fundSeconds);
		setText(asText);
	}

	const mutation = useMutation({
		mutationFn: (hours: number | null) =>
			hours == null
				? clearMonthlyHourFund({ data: { year, month } })
				: setMonthlyHourFund({
						data: { year, month, fundSeconds: Math.round(hours * 3600) },
					}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: hourFundYearQuery(orgSlug, year).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save");
			setText(asText);
		},
	});

	return (
		<TableRow>
			<TableCell className="font-medium">{MONTHS[month - 1]}</TableCell>
			<TableCell>
				<Input
					className="h-8 w-24 mono text-right"
					inputMode="decimal"
					placeholder="—"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onBlur={() => {
						const trimmed = text.trim();
						// Emptying the field clears the month. This used to be a silent
						// no-op — the input went blank, nothing was sent, and the old fund
						// was still there on the next load. It also left `prefillYear`
						// with nothing to fill, since it skips months that have a row.
						if (trimmed === "") {
							if (fundSeconds != null) mutation.mutate(null);
							return;
						}
						const hours = Number(trimmed);
						if (Number.isNaN(hours) || hours < 0) {
							setText(asText);
							return;
						}
						if (fundSeconds != null && Math.round(hours * 3600) === fundSeconds)
							return;
						mutation.mutate(hours);
					}}
				/>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{fundSeconds == null
					? "No Expected hours can be computed for this month"
					: `${fundSeconds / 3600 / 8} working days`}
			</TableCell>
		</TableRow>
	);
}

function HourFundPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const search = Route.useSearch();
	const thisYear = new Date().getUTCFullYear();
	const year = search.year ?? thisYear;
	const { data: funds } = useSuspenseQuery(hourFundYearQuery(orgSlug, year));
	const byMonth = new Map(funds.map((f) => [f.month, f.fundSeconds]));

	const prefill = useMutation({
		mutationFn: () => prefillHourFundYear({ data: { year } }),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({
				queryKey: hourFundYearQuery(orgSlug, year).queryKey,
			});
			toast.success(
				result.filled === 0
					? "Every month already has a fund"
					: `Filled ${result.filled} month${result.filled === 1 ? "" : "s"}`,
			);
		},
		onError: (error) => toast.error(error.message ?? "Could not prefill"),
	});

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Monthly hour fund"
				lede="The official number of working hours in each month. It's the denominator of everyone's expected hours, so a month left blank simply shows no expected figure rather than guessing one."
				action={
					<Button
						variant="outline"
						size="sm"
						disabled={prefill.isPending}
						onClick={() => prefill.mutate()}
					>
						{prefill.isPending ? "Filling…" : "Prefill from calendar"}
					</Button>
				}
			/>

			{/* The same stepper the timesheet and the reports use, one year at a
			    time. The year is a search param so a link to next year's fund can
			    be shared, and the loader already prefetches whichever year it names. */}
			<div className="mb-4">
				<TimeToolbar
					prev={
						<Link
							to="/$orgSlug/settings/hour-fund"
							params={{ orgSlug }}
							search={{ year: year - 1 }}
							className={stepperClass}
							aria-label="Previous year"
						>
							<ArrowLeftIcon weight="regular" className="size-4" />
						</Link>
					}
					label={String(year)}
					next={
						<Link
							to="/$orgSlug/settings/hour-fund"
							params={{ orgSlug }}
							search={{ year: year + 1 }}
							className={stepperClass}
							aria-label="Next year"
						>
							<ArrowRightIcon weight="regular" className="size-4" />
						</Link>
					}
					returnLink={
						year !== thisYear && (
							<Link
								to="/$orgSlug/settings/hour-fund"
								params={{ orgSlug }}
								search={{}}
								className={returnLinkClass}
							>
								This year
							</Link>
						)
					}
				/>
			</div>

			<Table>
				<TableHeader>
					<TableRow>
						{/* Fixed widths: the note column's text differs by year ("21 working
						    days" vs "No Expected hours can be computed"), and letting it size
						    the table made the Hours column jump between years. */}
						<TableHead className="w-40">Month</TableHead>
						<TableHead className="w-36">Hours</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{MONTH_NUMBERS.map((month) => (
						<MonthRow
							key={`${year}-${month}`}
							year={year}
							month={month}
							fundSeconds={byMonth.get(month) ?? null}
						/>
					))}
				</TableBody>
			</Table>
			<p className="mt-3 text-xs text-muted-foreground">
				Prefilling counts Mon–Fri days that aren't public holidays and
				multiplies by 8. The legal fund sometimes differs, so check the number
				before you rely on it.
			</p>
		</Page>
	);
}
