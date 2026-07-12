import { cn } from "#/lib/utils.ts";

type TimeOffStatus = "pending" | "approved" | "denied";

// Soft-tint pills — a bit richer than the plain default/secondary Badge
// variants used for project/entry-type status, since here the color itself
// carries meaning (pending vs. approved vs. denied) rather than just on/off.
const STATUS_STYLES: Record<TimeOffStatus, string> = {
	pending: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
	approved: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
	denied: "bg-rose-500/12 text-rose-700 dark:text-rose-400",
};

export function TimeOffStatusPill({
	status,
	className,
}: {
	status: TimeOffStatus;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"inline-flex h-5 w-fit shrink-0 items-center rounded-4xl px-2 text-xs font-medium capitalize whitespace-nowrap",
				STATUS_STYLES[status],
				className,
			)}
		>
			{status}
		</span>
	);
}
