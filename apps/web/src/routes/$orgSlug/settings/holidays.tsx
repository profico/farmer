import { matchesSearch } from "@farmer/core/lib/search";
import { dayKeyInTz } from "@farmer/core/lib/time";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { SearchInput } from "#/components/ui/search-input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { cn } from "#/lib/utils.ts";
import { holidaysForYearWithStatusQuery } from "#/queries/holidays.ts";
import { queryKeys } from "#/queries/keys.ts";
import { setHolidayDisabled } from "#/server/holidays.ts";

// The year's public holidays as one list, with a switch to turn a day off.
// That is the whole page (Sept 2026): the calendar is data — it feeds the
// hour fund's prefill, time-off spans, the reminders and every target's
// working-day count — and the one decision an admin makes about it is which
// days the company does not observe. The Relative/Single views and the
// upcoming/past split it used to have were two ways of reading a list of
// fourteen dates.

const searchSchema = z.object({
	year: z.number().int().optional(),
});

export const Route = createFileRoute("/$orgSlug/settings/holidays")({
	validateSearch: searchSchema,
	loaderDeps: ({ search }) => ({ year: search.year }),
	loader: async ({ context, deps, params }) => {
		const orgSlug = params.orgSlug;
		const year =
			deps.year ??
			Number(dayKeyInTz(new Date(), context.organization.timezone).slice(0, 4));
		await context.queryClient.ensureQueryData(
			holidaysForYearWithStatusQuery(orgSlug, year),
		);
	},
	component: HolidaysSettingsPage,
});

const weekdayFor = (dateKey: string) =>
	new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
		weekday: "long",
		timeZone: "UTC",
	});

// "2026-01-01" → "January 1". The year lives in the year selector and the
// weekday in its own column, so the date cell just needs month + day.
const formatHolidayDate = (dateKey: string) =>
	new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});

function HolidaysSettingsPage() {
	const orgSlug = useOrgSlug();
	const { organization, role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const todayKey = dayKeyInTz(new Date(), organization.timezone);
	const currentYear = Number(todayKey.slice(0, 4));
	const year = search.year ?? currentYear;
	const { data: holidays } = useSuspenseQuery(
		holidaysForYearWithStatusQuery(orgSlug, year),
	);

	const [query, setQuery] = useState("");
	const matching = holidays.filter((h) => matchesSearch(query, [h.name]));

	/* Optimistic, and scoped to the one holiday: the whole table shares this
	   mutation, so anything keyed off `isPending` (or a refetch-before-paint)
	   would dim every other row while a single switch is in flight. */
	const toggleMutation = useMutation({
		mutationFn: (vars: { name: string; disabled: boolean }) =>
			setHolidayDisabled({ data: vars }),
		onMutate: async (vars) => {
			const queryKey = holidaysForYearWithStatusQuery(orgSlug, year).queryKey;
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			queryClient.setQueryData(queryKey, (old) =>
				old?.map((h) =>
					h.name === vars.name ? { ...h, disabled: vars.disabled } : h,
				),
			);
			return { queryKey, previous };
		},
		onError: (error, _vars, context) => {
			if (context) {
				queryClient.setQueryData(context.queryKey, context.previous);
			}
			toast.error(error.message ?? "Could not update holiday");
		},
		// Every other reader of the calendar — the timesheet's week strip, the
		// targets, the fund's prefill — needs the server's answer.
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).holidays],
			}),
	});

	const goToYear = (next: number) =>
		navigate({
			search: { year: next === currentYear ? undefined : next },
		});

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Holidays"
				lede={
					<>
						Public holidays for this organization's country. They are left out
						of every target: a working day is Monday to Friday minus these.
						{isAdmin && " Turn off any your company doesn't observe."}
					</>
				}
				/* The year is the page's subject, so it is set as a figure — mono,
				   large, with the steppers reduced to quiet glyphs either side. */
				action={
					<div className="flex flex-wrap items-center gap-4">
						<SearchInput
							value={query}
							onValueChange={setQuery}
							placeholder="Search holidays…"
							className="w-44"
						/>
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => goToYear(year - 1)}
								aria-label="Previous year"
							>
								<CaretLeftIcon weight="regular" className="size-4" />
							</Button>
							<span className="mono w-20 text-center text-xl">{year}</span>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => goToYear(year + 1)}
								aria-label="Next year"
							>
								<CaretRightIcon weight="regular" className="size-4" />
							</Button>
						</div>
					</div>
				}
			/>

			{holidays.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No public holidays found for this country and year.
				</p>
			) : matching.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No holidays match your search.
				</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>Day</TableHead>
							<TableHead>Holiday</TableHead>
							<TableHead className="text-right">
								{isAdmin ? "Observed" : "Status"}
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{matching.map((h) => (
							<TableRow
								key={h.date}
								className={cn(
									h.disabled && "opacity-50",
									h.date < todayKey && "text-muted-foreground",
								)}
							>
								<TableCell className="mono">
									{formatHolidayDate(h.date)}
								</TableCell>
								<TableCell>{weekdayFor(h.date)}</TableCell>
								<TableCell className="font-medium">{h.name}</TableCell>
								<TableCell className="text-right">
									{isAdmin ? (
										<Switch
											checked={!h.disabled}
											aria-label={`${h.name} observed`}
											onCheckedChange={(checked) =>
												toggleMutation.mutate({
													name: h.name,
													disabled: !checked,
												})
											}
										/>
									) : (
										<span className="text-sm text-muted-foreground">
											{h.disabled ? "Not observed" : "Observed"}
										</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</Page>
	);
}
