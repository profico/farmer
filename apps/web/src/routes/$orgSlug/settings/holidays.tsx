import { dayKeyInTz } from "@farmer/core/lib/time";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
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
	loader: async ({ context, deps }) => {
		const year =
			deps.year ??
			Number(dayKeyInTz(new Date(), context.organization.timezone).slice(0, 4));
		await context.queryClient.ensureQueryData(
			holidaysForYearWithStatusQuery(year),
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
		holidaysForYearWithStatusQuery(year),
	);

	/* Optimistic, and scoped to the one holiday: the whole table shares this
	   mutation, so anything keyed off `isPending` (or a refetch-before-paint)
	   would dim every other row while a single switch is in flight. */
	const toggleMutation = useMutation({
		mutationFn: (vars: { name: string; disabled: boolean }) =>
			setHolidayDisabled({ data: vars }),
		onMutate: async (vars) => {
			const queryKey = holidaysForYearWithStatusQuery(year).queryKey;
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
			queryClient.invalidateQueries({ queryKey: [...queryKeys.holidays] }),
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
				}
				className="mb-0"
			/>

			{holidays.length === 0 ? (
				<p className="mt-6 text-sm text-muted-foreground">
					No public holidays found for this country and year.
				</p>
			) : (
				<Table containerClassName="mt-6">
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
						{holidays.map((h) => (
							<TableRow key={h.date} className={cn(h.disabled && "opacity-50")}>
								<TableCell className="tnum">
									{formatHolidayDate(h.date)}
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
			)}
		</Page>
	);
}
