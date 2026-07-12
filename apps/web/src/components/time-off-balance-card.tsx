import { formatDayKey } from "@farmer/core/lib/time";
import { useSuspenseQuery } from "@tanstack/react-query";
import { timeOffBalanceQuery } from "#/queries/time-off.ts";

function Stat({ label, value }: { label: string; value: string | number }) {
	return (
		<div>
			<p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
				{label}
			</p>
			<p className="font-display text-xl">{value}</p>
		</div>
	);
}

export function TimeOffBalanceCard() {
	const { data: balance } = useSuspenseQuery(timeOffBalanceQuery());

	return (
		<div className="px-4 py-4 sm:px-8">
			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<Stat label="Allowance" value={balance.allowanceDays} />
				<Stat label="Used" value={balance.usedDays} />
				<Stat label="Pending" value={balance.pendingDays} />
				<Stat label="Remaining" value={balance.remainingDays} />
			</div>
			{balance.carryoverDays > 0 && (
				<p className="mt-3 text-2xs text-muted-foreground">
					Includes {balance.carryoverDays} carried-over day
					{balance.carryoverDays === 1 ? "" : "s"} (expires{" "}
					{formatDayKey(balance.carryoverExpiry)}).
				</p>
			)}
		</div>
	);
}
