import { dayKeyInTz } from "@farmer/core/lib/time";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import {
	SegmentedControl,
	SegmentedControlItem,
} from "#/components/ui/segmented-control.tsx";
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

const relativeFormat = new Intl.RelativeTimeFormat("en-US", {
	numeric: "auto",
});

// "in 3 days" / "2 weeks ago", with `numeric: "auto"` supplying "today",
// "tomorrow" and "yesterday". Day keys compare as UTC midnights, so the
// difference is always a whole number of days.
const relativeLabel = (dateKey: string, todayKey: string): string => {
	const days = Math.round(
		(Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) /
			86_400_000,
	);
	if (Math.abs(days) < 7) return relativeFormat.format(days, "day");
	if (Math.abs(days) < 30) {
		return relativeFormat.format(Math.round(days / 7), "week");
	}
	return relativeFormat.format(Math.round(days / 30), "month");
};

// "relative" splits the year on today and badges each date; "single" is the
// plain chronological table. A display preference, so it lives in
// localStorage rather than on the org.
type HolidaysView = "relative" | "single";
const VIEW_STORAGE_KEY = "farmer:holidays-view";

function HolidaysSettingsPage() {
	const orgSlug = useOrgSlug();
	const { organization, role } = Route.useRouteContext();
	const isAdmin = role === "owner" || role === "admin";
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const queryClient = useQueryClient();
	const currentYear = Number(
		dayKeyInTz(new Date(), organization.timezone).slice(0, 4),
	);
	const year = search.year ?? currentYear;
	const { data: holidays } = useSuspenseQuery(
		holidaysForYearWithStatusQuery(orgSlug, year),
	);

	/* Start on "relative" and only apply the stored choice after mount, the
	   same SSR-safe read auto-track-nag uses: the first client render must
	   match the server's HTML. */
	const [view, setView] = useState<HolidaysView>("relative");
	useEffect(() => {
		try {
			if (window.localStorage.getItem(VIEW_STORAGE_KEY) === "single") {
				setView("single");
			}
		} catch {
			// Private-mode / disabled storage: keep the default.
		}
	}, []);

	const switchView = (next: HolidaysView) => {
		setView(next);
		try {
			window.localStorage.setItem(VIEW_STORAGE_KEY, next);
		} catch {
			// Private-mode / disabled storage: the choice holds for this session.
		}
	};

	/* Split on the org-timezone today. A past or future year lands whole in
	   one section, so the other heading simply does not render. */
	const todayKey = dayKeyInTz(new Date(), organization.timezone);
	const sections: { heading: string | null; rows: typeof holidays }[] =
		view === "single"
			? [{ heading: null, rows: holidays }]
			: [
					{
						heading: "Upcoming",
						rows: holidays.filter((h) => h.date >= todayKey),
					},
					{ heading: "Past", rows: holidays.filter((h) => h.date < todayKey) },
				].filter((section) => section.rows.length > 0);

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
		// Other holiday views (calendar ranges) still need the server's answer.
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
		<Page className="screen">
			<PageHeader
				eyebrow="Workspace"
				title="Holidays"
				lede={
					<>
						Public holidays for this organization's country.
						{isAdmin && " Turn off any your company doesn't observe."}
					</>
				}
				/* The year is the page's subject, so it is set as a figure — mono,
				   large, with the steppers reduced to quiet glyphs either side. */
				action={
					<div className="flex items-center gap-4">
						<SegmentedControl>
							<SegmentedControlItem
								active={view === "relative"}
								onClick={() => switchView("relative")}
							>
								Relative
							</SegmentedControlItem>
							<SegmentedControlItem
								active={view === "single"}
								onClick={() => switchView("single")}
							>
								Single
							</SegmentedControlItem>
						</SegmentedControl>
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
				className="mb-0"
			/>

			{holidays.length === 0 ? (
				<p className="mt-6 text-sm text-muted-foreground">
					No public holidays found for this country and year.
				</p>
			) : (
				sections.map((section, index) => (
					<div
						key={section.heading ?? "all"}
						className={index === 0 ? "mt-6" : "mt-8"}
					>
						{section.heading !== null && (
							<h2 className="eyebrow">{section.heading}</h2>
						)}
						<Table containerClassName={cn(section.heading !== null && "mt-3")}>
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
								{section.rows.map((h) => (
									<TableRow
										key={h.date}
										className={cn(h.disabled && "opacity-50")}
									>
										<TableCell className="tnum">
											{view === "relative" ? (
												<span className="flex items-center gap-2">
													{formatHolidayDate(h.date)}
													<Badge
														variant={
															h.date < todayKey ? "outline" : "secondary"
														}
													>
														{relativeLabel(h.date, todayKey)}
													</Badge>
												</span>
											) : (
												formatHolidayDate(h.date)
											)}
										</TableCell>
										<TableCell>{weekdayFor(h.date)}</TableCell>
										<TableCell className="font-medium">{h.name}</TableCell>
										<TableCell className="text-right">
											{isAdmin ? (
												<Switch
													checked={!h.disabled}
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
					</div>
				))
			)}
		</Page>
	);
}
