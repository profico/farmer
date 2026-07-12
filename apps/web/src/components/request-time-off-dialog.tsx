import { countWorkingDays, formatDayKeyRange } from "@farmer/core/lib/time";
import {
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	type DateRange,
	TimeOffCalendar,
} from "#/components/time-off-calendar.tsx";
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
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { holidaysForRangeQuery } from "#/queries/holidays.ts";
import {
	eligibleReviewersQuery,
	myTimeOffQuery,
	timeOffBalanceQuery,
} from "#/queries/time-off.ts";
import { workingHoursQuery } from "#/queries/working-hours.ts";
import { createTimeOffRequest } from "#/server/time-off.ts";

const TYPE_ITEMS = [
	{ value: "vacation", label: "Vacation" },
	{ value: "sick", label: "Sick" },
	{ value: "personal", label: "Personal" },
	{ value: "unpaid", label: "Unpaid" },
	{ value: "other", label: "Other" },
] as const;

type TimeOffType = (typeof TYPE_ITEMS)[number]["value"];

const ANY_REVIEWER = "any";

export function RequestTimeOffDialog({ timezone }: { timezone: string }) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	const [range, setRange] = useState<DateRange | null>(null);
	const [type, setType] = useState<TimeOffType>("vacation");
	const [note, setNote] = useState("");
	const [reviewer, setReviewer] = useState(ANY_REVIEWER);

	const { data: workingDays } = useQuery(workingHoursQuery());
	const { data: balance } = useQuery(timeOffBalanceQuery());
	const { data: reviewers = [] } = useQuery(eligibleReviewersQuery());
	const { data: holidayEntries = [] } = useQuery({
		...holidaysForRangeQuery(
			range ?? { from: "", to: "" }
				? { from: range?.startDate ?? "", to: range?.endDate ?? "" }
				: { from: "", to: "" },
		),
		enabled: Boolean(range),
	});

	const enabledWeekdays = useMemo(
		() =>
			new Set((workingDays ?? []).filter((d) => d.enabled).map((d) => d.dayOfWeek)),
		[workingDays],
	);

	const requestedDays = useMemo(() => {
		if (!range) return 0;
		return countWorkingDays(
			range.startDate,
			range.endDate,
			enabledWeekdays,
			new Set(holidayEntries.map(([key]) => key)),
		);
	}, [range, enabledWeekdays, holidayEntries]);

	const isVacation = type === "vacation";
	const remaining = balance?.remainingDays ?? 0;
	const remainingAfter = isVacation ? remaining - requestedDays : remaining;
	const overBudget = isVacation && requestedDays > remaining;

	const reviewerItems = useMemo(
		() => [
			{ value: ANY_REVIEWER, label: "Any approver" },
			...reviewers.map((r) => ({ value: r.userId, label: r.name })),
		],
		[reviewers],
	);

	const reset = () => {
		setRange(null);
		setType("vacation");
		setNote("");
		setReviewer(ANY_REVIEWER);
	};

	const mutation = useMutation({
		mutationFn: () => {
			if (!range) throw new Error("Pick a date range");
			return createTimeOffRequest({
				data: {
					startDate: range.startDate,
					endDate: range.endDate,
					type,
					label: note || undefined,
					reviewerUserId:
						reviewer === ANY_REVIEWER ? undefined : reviewer,
				},
			});
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: myTimeOffQuery().queryKey }),
				queryClient.invalidateQueries({
					queryKey: ["time-off", "balance"],
				}),
			]);
			setOpen(false);
			reset();
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not request time off");
		},
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger
				render={
					<Button variant="ghost" size="icon-sm">
						<PlusIcon className="size-4" />
						<span className="sr-only">Request time off</span>
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Request time off</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						mutation.mutate();
					}}
					className="grid gap-4"
				>
					<TimeOffCalendar
						timezone={timezone}
						value={range}
						onChange={setRange}
					/>

					<div className="grid gap-2 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label>Type</Label>
							<Select
								value={type}
								onValueChange={(v) => v && setType(v as TimeOffType)}
								items={TYPE_ITEMS.map((i) => ({ value: i.value, label: i.label }))}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TYPE_ITEMS.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="grid gap-1.5">
							<Label>Reviewer</Label>
							<Select
								value={reviewer}
								onValueChange={(v) => v && setReviewer(v)}
								items={reviewerItems}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{reviewerItems.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					<div className="grid gap-1.5">
						<Label>Note (optional)</Label>
						<Input
							placeholder="e.g. Family trip"
							value={note}
							onChange={(e) => setNote(e.target.value)}
						/>
					</div>

					{range && (
						<div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
							<p className="font-medium">
								{formatDayKeyRange(range.startDate, range.endDate)}
							</p>
							<p className="text-muted-foreground">
								{requestedDays} working day{requestedDays === 1 ? "" : "s"}
								{isVacation && (
									<>
										{" · "}
										<span className={overBudget ? "text-destructive" : ""}>
											Remaining after: {remainingAfter} / {balance?.allowanceDays ?? 0}
										</span>
									</>
								)}
							</p>
							{isVacation && overBudget && (
								<p className="mt-0.5 text-2xs text-destructive">
									Exceeds your remaining balance.
								</p>
							)}
						</div>
					)}

					<DialogFooter>
						<Button
							type="submit"
							disabled={mutation.isPending || !range || overBudget}
						>
							Request
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
