import { formatDurationLong } from "@farmer/core/lib/time";
import type { ComponentProps } from "react";
import type { EntryBlockRowEntry } from "#/components/time/entry-block-row.tsx";
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { cn } from "#/lib/utils.ts";

function hoursMinutes(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	return `${hours}:${String(minutes).padStart(2, "0")}`;
}

export function CalendarBlock({
	entry,
	variant,
	startLabel,
	style,
	className,
	...props
}: {
	entry: EntryBlockRowEntry;
	variant: "day" | "week";
	startLabel: string;
} & ComponentProps<"button">) {
	const category = resolveCategoryColor(entry.type.color);
	const title = entry.project
		? `${entry.type.name} — ${entry.project.name}`
		: entry.type.name;
	const subtitle = [
		entry.project?.name,
		variant === "day" ? undefined : startLabel,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<button
			type="button"
			style={{
				...style,
				background: category.tint,
				color: category.text,
			}}
			className={cn(
				"absolute overflow-hidden rounded-md px-2 py-1 text-left text-[11.5px] leading-tight",
				variant === "day" && "flex items-start justify-between gap-2",
				className,
			)}
			aria-label={`${title}, ${startLabel}, ${formatDurationLong(entry.durationSeconds)}`}
			{...props}
		>
			<span className="min-w-0">
				<span className="flex items-center gap-1.5">
					<span
						className="size-1.5 shrink-0 rounded-full"
						style={{ backgroundColor: category.dot }}
					/>
					<span className="truncate font-semibold">{title}</span>
				</span>
				{subtitle && (
					<span className="block truncate pl-3 opacity-80">{subtitle}</span>
				)}
			</span>
			{variant === "day" && (
				<span className="shrink-0 text-right">
					<span className="tnum block text-[13px] font-semibold leading-none">
						{hoursMinutes(entry.durationSeconds)}
					</span>
					<span className="block text-[10px] opacity-75">{startLabel}</span>
				</span>
			)}
		</button>
	);
}
