import { formatDurationInput } from "@farmer/core/lib/time";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Input } from "#/components/ui/input.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { cn } from "#/lib/utils.ts";
import { workingHoursQuery } from "#/queries/working-hours.ts";
import { upsertWorkingHoursDay } from "#/server/working-hours.ts";

export type WorkingHoursDay = {
	dayOfWeek: number;
	enabled: boolean;
	startTime: string | null;
	endTime: string | null;
};

// DB dayOfWeek is 0=Sun..6=Sat (matches Date#getDay()/weekdayInTz).
const DAY_LABELS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

const minutesOf = (time: string): number => {
	const [h, m] = time.split(":").map(Number);

	return (h ?? 0) * 60 + (m ?? 0);
};

export function WorkingHoursRow({ day }: { day: WorkingHoursDay }) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [startTime, setStartTime] = useState(day.startTime ?? "09:00");
	const [endTime, setEndTime] = useState(day.endTime ?? "17:00");

	useEffect(() => {
		setStartTime(day.startTime ?? "09:00");
		setEndTime(day.endTime ?? "17:00");
	}, [day.startTime, day.endTime]);

	const mutation = useMutation({
		mutationFn: (input: {
			enabled: boolean;
			startTime: string;
			endTime: string;
		}) =>
			upsertWorkingHoursDay({
				data: {
					dayOfWeek: day.dayOfWeek,
					enabled: input.enabled,
					startTime: input.startTime,
					endTime: input.endTime,
				},
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: workingHoursQuery(orgSlug).queryKey,
			}),
		onError: (error) => {
			toast.error(error.message ?? "Could not update working hours");
		},
	});

	const dailySeconds =
		day.enabled && endTime > startTime
			? (minutesOf(endTime) - minutesOf(startTime)) * 60
			: 0;

	return (
		// A day off is dimmed rather than the working days being tinted: seven
		// tinted rows out of seven is not a highlight, it's a background.
		<div
			className={cn(
				"flex min-h-8 items-center gap-3 px-4 py-2.5 sm:px-8",
				!day.enabled && "text-muted-foreground",
			)}
		>
			<Switch
				checked={day.enabled}
				onCheckedChange={(enabled) =>
					mutation.mutate({ enabled, startTime, endTime })
				}
			/>
			<span
				className={cn("w-24 shrink-0 text-base", day.enabled && "font-medium")}
			>
				{DAY_LABELS[day.dayOfWeek]}
			</span>
			{day.enabled ? (
				<>
					<Input
						type="time"
						value={startTime}
						onChange={(e) => setStartTime(e.target.value)}
						onBlur={() =>
							mutation.mutate({ enabled: true, startTime, endTime })
						}
						className="w-32"
					/>
					<span className="text-faint">–</span>
					<Input
						type="time"
						value={endTime}
						onChange={(e) => setEndTime(e.target.value)}
						onBlur={() =>
							mutation.mutate({ enabled: true, startTime, endTime })
						}
						className="w-32"
					/>
					<span className="mono ml-auto shrink-0 text-sm text-muted-foreground">
						{formatDurationInput(dailySeconds)}
					</span>
				</>
			) : (
				<span className="eyebrow ml-auto">Day off</span>
			)}
		</div>
	);
}
