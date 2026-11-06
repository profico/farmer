// Where a background job reports a failure it caught and went on from.
//
// The same seam as `services/ai-telemetry.ts`: `packages/core` must stay
// runnable from a process with no analytics vendor in it, so core calls
// `reportJobFailure` and the host decides whether anything listens. The web
// host installs a PostHog sink (`apps/web/src/lib/posthog-jobs.ts`). The
// standalone worker installs none, because core holds no PostHog client.
//
// **Nothing here may ever throw or wait.** A job that logs a failure and goes
// on must still go on when the sink is broken.
//
// A tick that fails for every person would send one report for each of them.
// `withJobFailureBudget` gives each tick of a job a small budget, and a report
// past it is dropped. The log line a job writes beside the report is not.

import { AsyncLocalStorage } from "node:async_hooks";

/** Reports one tick may send. Enough to see a pattern, too few to flood. */
export const JOB_FAILURE_BUDGET = 20;

export type JobFailure = {
	/** The job, in its own words: `slack-reminders`, `timer-sweep`. */
	job: string;
	/** What was thrown. The sink must not send a query's values. */
	error: unknown;
	organizationId?: string;
	userId?: string;
};

export type JobFailureSink = (failure: JobFailure) => void;

let sink: JobFailureSink | null = null;

/** Install the adapter. Pass null to remove it. */
export const setJobFailureSink = (next: JobFailureSink | null): void => {
	sink = next;
};

const budgets = new AsyncLocalStorage<{ left: number }>();

/** Run one tick of a job with a fresh budget of reports. */
export const withJobFailureBudget = <T>(run: () => Promise<T>): Promise<T> =>
	budgets.run({ left: JOB_FAILURE_BUDGET }, run);

// shortcut: outside a tick (a direct call in a test or a script) the budget
// is not enforced; the scheduler is the only caller that needs it.
export const reportJobFailure = (failure: JobFailure): void => {
	if (!sink) return;
	const budget = budgets.getStore();
	if (budget) {
		if (budget.left <= 0) return;
		budget.left -= 1;
	}
	try {
		sink(failure);
	} catch (error) {
		console.error("[job-failures] the sink refused a report", error);
	}
};
