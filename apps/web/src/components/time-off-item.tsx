import { datesBetween, formatDayKeyRange } from "@farmer/core/lib/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { TimeOffStatusPill } from "#/components/time-off-status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import { myTimeOffQuery } from "#/queries/time-off.ts";
import { cancelTimeOffRequest } from "#/server/time-off.ts";

export type TimeOffItemData = {
	id: string;
	startDate: string;
	endDate: string;
	label: string | null;
	status: "pending" | "approved" | "denied";
};

export function TimeOffItem({ item }: { item: TimeOffItemData }) {
	const queryClient = useQueryClient();

	const cancelMutation = useMutation({
		mutationFn: () => cancelTimeOffRequest({ data: item.id }),
		onSuccess: () =>
			queryClient.invalidateQueries({ queryKey: myTimeOffQuery().queryKey }),
		onError: (error) => {
			toast.error(error.message ?? "Could not cancel time off request");
		},
	});

	const range = formatDayKeyRange(item.startDate, item.endDate);
	const dayCount = datesBetween(item.startDate, item.endDate).length;

	return (
		<div className="flex items-start justify-between gap-2 px-4 py-2.5 sm:px-8">
			<div className="min-w-0">
				<p className="truncate text-sm font-medium">{range}</p>
				<p className="text-2xs text-muted-foreground">
					{dayCount} day{dayCount === 1 ? "" : "s"}
				</p>
				{item.label && (
					<p className="truncate text-sm text-muted-foreground">{item.label}</p>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				<TimeOffStatusPill status={item.status} />
				{item.status === "pending" && (
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={() => cancelMutation.mutate()}
						disabled={cancelMutation.isPending}
					>
						<XIcon className="size-3" />
						<span className="sr-only">Cancel request</span>
					</Button>
				)}
			</div>
		</div>
	);
}
