import { dayKeyInTz } from "@farmer/core/lib/time";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "#/components/ui/button.tsx";
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

	const toggleMutation = useMutation({
		mutationFn: (vars: { name: string; disabled: boolean }) =>
			setHolidayDisabled({ data: vars }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["holidays"] }),
			]);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update holiday");
		},
	});

	const goToYear = (next: number) =>
		navigate({
			search: { year: next === currentYear ? undefined : next },
		});

	return (
		<div className="page-shell">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="font-display text-xl">Holidays</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						Public holidays for this organization's country.
						{isAdmin && " Turn off any your company doesn't observe."}
					</p>
				</div>
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						onClick={() => goToYear(year - 1)}
						aria-label="Previous year"
					>
						<ChevronLeft className="size-4" />
					</Button>
					<span className="w-24 text-center font-display text-4xl tnum">
						{year}
					</span>
					<Button
						variant="ghost"
						size="icon"
						onClick={() => goToYear(year + 1)}
						aria-label="Next year"
					>
						<ChevronRight className="size-4" />
					</Button>
				</div>
			</div>

			{holidays.length === 0 ? (
				<p className="mt-6 text-sm text-muted-foreground">
					No public holidays found for this country and year.
				</p>
			) : (
				<Table
					className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
					containerClassName="-mx-4 mt-6 border-b sm:-mx-8"
				>
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
											disabled={toggleMutation.isPending}
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
		</div>
	);
}
