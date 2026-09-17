import { TimerIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { queryKeys } from "#/queries/keys.ts";
import { timerSettingsQuery } from "#/queries/timer.ts";
import { setTimerSettings } from "#/server/timer.ts";

// The answer to "people forget to stop a stopwatch" (issue #59). The limit is
// the person's own, because the hour somebody works past is theirs: a
// nine-to-five day and a night of live support need different numbers, and one
// workspace-wide ceiling would have to be wrong for one of them.
//
// A timer past the limit is dropped and logs NOTHING. Farmer never invents a
// duration from a clock nobody stopped, so the worst a forgotten timer costs
// is the measurement, never a wrong entry on a timesheet.

const HOUR_OPTIONS = [4, 6, 8, 10, 12, 16, 24].map((hours) => ({
	value: String(hours * 3600),
	label: hours === 1 ? "1 hour" : `${hours} hours`,
}));

export function TimerSettings() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: settings } = useQuery(timerSettingsQuery(orgSlug));

	const save = useMutation({
		mutationFn: (maxSeconds: number) =>
			setTimerSettings({ data: { maxSeconds } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).timer],
			});
			toast.success("Timer limit saved");
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<PageSection
			title="Timer"
			description="The stopwatch on the Time page and in the CLI."
		>
			<SettingList>
				<SettingRow
					icon={<TimerIcon className="size-5 text-muted-foreground" />}
					title="Drop a timer after"
					description="A timer that runs longer than this is dropped, and logs nothing. You are told where you work, so you can put the time in by hand."
					action={
						<Select
							value={String(settings?.maxSeconds ?? "")}
							onValueChange={(next) => {
								save.mutate(Number(next));
							}}
							items={HOUR_OPTIONS}
							disabled={!settings || save.isPending}
						>
							<SelectTrigger className="w-40" aria-label="Drop a timer after">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{HOUR_OPTIONS.map((opt) => (
									<SelectItem key={opt.value} value={opt.value}>
										{opt.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					}
				/>
			</SettingList>
		</PageSection>
	);
}
