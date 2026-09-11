import { Button } from "#/components/ui/button.tsx";
import { Metric } from "#/components/ui/metric.tsx";
import { PageSection } from "#/components/ui/page-header.tsx";
import { formatDateKeyLong } from "#/lib/format-date.ts";

import type { ImportRunnerState } from "./use-import-runner.ts";

const count = (n: number) => n.toLocaleString("en-US");

/** The import and done steps: a bar while it runs, the counts after. */
export function ImportProgress({
	state,
	onRetry,
	onReset,
}: {
	state: ImportRunnerState;
	onRetry: () => void;
	onReset: () => void;
}) {
	if (state.status === "done") {
		const created = state.created;
		const finish = state.finish;
		return (
			<PageSection
				title="Import done"
				action={<Button onClick={onReset}>Import more files</Button>}
			>
				<div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
					<Metric
						size={24}
						value={count(state.inserted)}
						label="Entries added"
					/>
					<Metric
						size={24}
						value={count(state.deleted)}
						label="Entries replaced or removed"
					/>
					<Metric
						size={24}
						value={count(state.unchangedDays)}
						label="Days already imported"
					/>
					<Metric
						size={24}
						value={count(state.keptDays.length)}
						label="Days kept because they were edited here"
					/>
					{created && (
						<>
							<Metric
								size={24}
								value={count(created.people)}
								label="People added"
							/>
							<Metric
								size={24}
								value={count(created.projects)}
								label="Projects added"
							/>
							<Metric
								size={24}
								value={count(created.clients)}
								label="Clients added"
							/>
							<Metric
								size={24}
								value={count(created.tasks)}
								label="Tasks added"
							/>
						</>
					)}
					{finish && (
						<>
							<Metric
								size={24}
								value={count(finish.closesCreated + finish.closesUpdated)}
								label="History closes written"
							/>
							<Metric
								size={24}
								value={count(finish.closesSkipped)}
								label="Closes left alone because they were changed here"
							/>
						</>
					)}
				</div>
				{finish && (
					<p className="mt-8 max-w-[68ch] text-sm text-muted-foreground">
						Calendar, commit and recurring-block automation no longer writes to{" "}
						{formatDateKeyLong(finish.automationLockedThrough)} or earlier.
					</p>
				)}
			</PageSection>
		);
	}

	const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
	return (
		<PageSection title="Importing">
			<div className="flex items-baseline justify-between gap-4 text-sm">
				<span>{state.step || "Starting"}</span>
				<span className="mono text-muted-foreground">{pct}%</span>
			</div>
			<progress
				aria-label="Import progress"
				max={100}
				value={pct}
				className="mt-3 block h-2 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-(--dur-slow)"
			/>
			<p className="mt-3 max-w-[68ch] text-sm text-muted-foreground">
				{count(state.inserted)} entries added so far. Keep this tab open. If it
				closes, drop the same files again: the import skips the rows that it
				already added.
			</p>
			{state.status === "failed" && (
				<div className="mt-5 flex flex-col items-start gap-3 rounded-md bg-destructive/8 px-4 py-3">
					<p className="text-sm text-destructive">{state.error}</p>
					<div className="flex gap-2">
						<Button onClick={onRetry}>Retry</Button>
						<Button variant="ghost" onClick={onReset}>
							Stop
						</Button>
					</div>
				</div>
			)}
		</PageSection>
	);
}
