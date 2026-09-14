/**
 * The task runner.
 *
 * This deployment is a single long-lived Bun process, not a serverless
 * function, so an interval loop is the whole mechanism — no external cron, no
 * queue. That is also why nothing in this app needs to hang background work off
 * a page load; if you find yourself writing entries inside a read handler, this
 * file is the reason you don't have to.
 *
 * It lives in `packages/core` rather than in `apps/web/server.ts` (where it
 * started) for two reasons:
 *
 *   - `vite dev` never loads server.ts, so with the sync engines moved off the
 *     read path there would otherwise be NOTHING running them in development.
 *     `bun run worker` (jobs/worker.ts) starts exactly these schedulers as their
 *     own process.
 *   - It makes the worker separable in production. Today the web host starts it
 *     in-process; splitting it onto its own container is now a deploy change,
 *     not a code change.
 *
 * Every job is idempotent by construction (the automation sweep reconciles
 * rather than appends; the log reminder guards on
 * notificationSettings.lastLogReminderDay; the Slack reminder claims a row in
 * slack_reminder_log before each send), so a missed, repeated or overlapping
 * tick is harmless.
 *
 * Environment variables:
 *   AUTOMATION_SYNC_ENABLED           - "false" to disable the automation sweep (default: on)
 *   AUTOMATION_SYNC_INTERVAL_MINUTES  - minutes between sweeps (default: 20)
 *   AUTOMATION_SYNC_CONCURRENCY       - people swept at once (default: 4)
 *   AUTOMATION_SYNC_USER_TIMEOUT_MS   - per-person ceiling (default: 120000)
 *   EXTERNAL_FETCH_TIMEOUT_MS         - deadline on every outbound API call (default: 15000)
 *   LOG_REMINDERS_ENABLED             - "false" to disable log reminders (default: on)
 *   LOG_REMINDERS_INTERVAL_MINUTES    - minutes between reminder sweeps (default: 30)
 *   SLACK_REMINDERS_ENABLED           - "false" to disable Slack reminders (default: on)
 *   SLACK_REMINDERS_INTERVAL_MINUTES  - minutes between Slack sweeps (default: 15)
 *   UPLOAD_SWEEP_ENABLED              - "false" to keep unused uploads (default: on)
 *   UPLOAD_SWEEP_INTERVAL_MINUTES     - minutes between upload sweeps (default: 1440)
 *   SCHEDULER_STARTUP_DELAY_MS        - delay before the first tick (default: 15000)
 *
 * NOTE: assumes a single instance. If ever scaled to multiple replicas, each
 * runs its own loop — harmless (idempotent) but redundant; move to a leader
 * lock or run exactly one worker container at that point.
 */

import { runAutomationSyncOnce } from "./automation-sync";
import { runLogRemindersOnce } from "./log-reminders";
import { runSlackRemindersOnce } from "./slack-reminders";
import { runUploadSweepOnce } from "./upload-sweep";

export interface SchedulerHandle {
	/** Clear the startup timeout and the recurring interval; no new ticks fire after this. */
	stopTimers: () => void;
	/** True while a tick is actively running. */
	isRunning: () => boolean;
	/** Resolves once the in-flight tick (if any) completes; resolves immediately otherwise. */
	waitUntilIdle: () => Promise<void>;
}

export interface SchedulerLogger {
	info: (message: string) => void;
	warn: (message: string) => void;
	error: (message: string) => void;
}

/**
 * Both of this module's tables — the default logger and the job list below —
 * are built by a hoisted function rather than held in a module-scope `const`,
 * and that is load-bearing in the production bundle.
 *
 * `bun build` (Dockerfile) wraps each module in a lazy initializer, and any
 * module that reaches an `--external` package (better-auth, via
 * auth → github.service → ports → automation-sync) becomes an *async* one. This
 * module's initializer therefore suspends at its `await` on the automation-sync
 * import — but the barrel in `index.ts` calls it without awaiting, so
 * `await import("@farmer/core/jobs")` hands out a namespace whose functions are
 * hoisted and callable while its `const`s are still unassigned. A `const JOBS`
 * read at that moment is `undefined`, which is exactly how the web host used to
 * die on startup with "undefined is not an object (evaluating 'JOBS.map')" —
 * silently, since the caller catches and the HTTP server comes up regardless,
 * leaving a deployment with no automation and no reminders at all.
 *
 * Function declarations are hoisted whole, so they cannot be observed
 * half-initialized. Keep it that way: a `const` here is a latent startup crash
 * that only ever reproduces in the built image, never in dev or in tests.
 */
function createDefaultLogger(): SchedulerLogger {
	return {
		info: (message) => {
			console.log(`[INFO] ${message}`);
		},
		warn: (message) => {
			console.log(`[WARNING] ${message}`);
		},
		error: (message) => {
			console.log(`[ERROR] ${message}`);
		},
	};
}

interface SchedulerConfig {
	/** Human name used in log lines, e.g. "Automation sync". */
	name: string;
	/** Env var set to "false" to disable this scheduler (default: enabled). */
	enabledEnv: string;
	/** Env var holding the interval in minutes. */
	intervalEnv: string;
	/** Interval used when intervalEnv is unset. */
	defaultIntervalMinutes: number;
	/** One tick of work; the returned string is logged as the run summary. The
	 *  logger is handed down so a job's own per-item failures land in the same
	 *  stream as the tick summary, rather than in a bare console.error the host's
	 *  formatter never sees. */
	run: (logger: SchedulerLogger) => Promise<string>;
}

function schedulerJobs(): SchedulerConfig[] {
	return [
		{
			name: "Automation sync",
			enabledEnv: "AUTOMATION_SYNC_ENABLED",
			intervalEnv: "AUTOMATION_SYNC_INTERVAL_MINUTES",
			// Twenty minutes is the resolution at which "my meeting showed up as a
			// block" feels automatic. The window is a whole day wide, so a finer
			// interval buys nothing but API calls.
			defaultIntervalMinutes: 20,
			run: async (logger) => {
				const s = await runAutomationSyncOnce(logger);
				return `${String(s.synced)}/${String(s.eligible)} people synced, ${String(s.failed)} failed`;
			},
		},
		{
			name: "Log reminders",
			enabledEnv: "LOG_REMINDERS_ENABLED",
			intervalEnv: "LOG_REMINDERS_INTERVAL_MINUTES",
			defaultIntervalMinutes: 30,
			run: async () => {
				const s = await runLogRemindersOnce();
				return `${String(s.sent)} sent, ${String(s.skipped)} skipped, ${String(s.failed)} failed (${String(s.eligible)} members)`;
			},
		},
		{
			name: "Slack reminders",
			enabledEnv: "SLACK_REMINDERS_ENABLED",
			intervalEnv: "SLACK_REMINDERS_INTERVAL_MINUTES",
			// Every 15 minutes, because an org may set any quarter hour as a send
			// time (Settings → Reminders). The job decides which day and time it
			// may send on, and a tick with nothing due ends before the compliance
			// queries, so the finer interval costs one settings read per org.
			defaultIntervalMinutes: 15,
			run: async () => {
				const s = await runSlackRemindersOnce();
				return `${String(s.nudges)} nudges, ${String(s.monthEnd)} month-end, ${String(s.digests)} digests, ${String(s.failed)} failed (${String(s.organizations)} orgs with Slack)`;
			},
		},
		{
			name: "Upload sweep",
			enabledEnv: "UPLOAD_SWEEP_ENABLED",
			intervalEnv: "UPLOAD_SWEEP_INTERVAL_MINUTES",
			// Daily. An unused file is at most 1 MB, and each deploy runs a pass
			// shortly after boot anyway.
			defaultIntervalMinutes: 1440,
			run: async (logger) => {
				const s = await runUploadSweepOnce({ logger });
				if (!s.enabled) return "no object store configured";
				return `${String(s.deleted)} deleted, ${String(s.failed)} failed (${String(s.listed)} objects)`;
			},
		},
	];
}

/** Start every scheduled job. Returns a handle per job that actually started. */
export const startSchedulers = (
	logger: SchedulerLogger = createDefaultLogger(),
): SchedulerHandle[] =>
	schedulerJobs()
		.map((config) => startIntervalScheduler(config, logger))
		.filter((handle): handle is SchedulerHandle => handle !== null);

const startIntervalScheduler = (
	config: SchedulerConfig,
	logger: SchedulerLogger,
): SchedulerHandle | null => {
	if ((process.env[config.enabledEnv] ?? "true") !== "true") {
		logger.info(`${config.name} scheduler disabled (${config.enabledEnv})`);
		return null;
	}

	const intervalMinutes = Number(
		process.env[config.intervalEnv] ?? config.defaultIntervalMinutes,
	);
	if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
		logger.warn(
			`Invalid ${config.intervalEnv} (${String(process.env[config.intervalEnv])}); ${config.name} scheduler not started`,
		);
		return null;
	}

	let running = false;
	let idleWaiters: Array<() => void> = [];
	const tick = async () => {
		if (running) {
			logger.warn(
				`${config.name}: previous run still in progress, skipping tick`,
			);
			return;
		}
		running = true;
		try {
			const summary = await config.run(logger);
			logger.info(`${config.name}: ${summary}`);
		} catch (error) {
			logger.error(`${config.name} run failed: ${String(error)}`);
		} finally {
			running = false;
			const waiters = idleWaiters;
			idleWaiters = [];
			for (const resolve of waiters) resolve();
		}
	};

	// First pass shortly after boot (don't compete with startup), then on the
	// interval. unref() so these timers never keep the process alive on their own
	// — the HTTP server or the worker's own hold does that.
	const startupDelayMs = Number(
		process.env.SCHEDULER_STARTUP_DELAY_MS ?? 15_000,
	);
	const startupTimer = setTimeout(() => {
		void tick();
	}, startupDelayMs).unref();
	const intervalTimer = setInterval(() => {
		void tick();
	}, intervalMinutes * 60_000).unref();
	logger.info(
		`${config.name} scheduler started (every ${String(intervalMinutes)} min)`,
	);

	return {
		stopTimers: () => {
			clearTimeout(startupTimer);
			clearInterval(intervalTimer);
		},
		isRunning: () => running,
		waitUntilIdle: () =>
			running
				? new Promise<void>((resolve) => {
						idleWaiters.push(resolve);
					})
				: Promise.resolve(),
	};
};

/**
 * Stop every scheduler cleanly: no new ticks, then wait (bounded) for the ones
 * in flight. Shared by the web host's SIGTERM handler and the standalone
 * worker, because "let the current sync finish" is the same problem in both.
 */
export const stopSchedulers = async (
	handles: SchedulerHandle[],
	graceMs: number,
	logger: SchedulerLogger = createDefaultLogger(),
): Promise<void> => {
	if (handles.length === 0) return;
	for (const handle of handles) handle.stopTimers();
	logger.info("Background scheduler timers stopped");

	const graceTimeout = new Promise<void>((resolve) => {
		setTimeout(resolve, graceMs).unref();
	});
	await Promise.race([
		Promise.all(handles.map((h) => h.waitUntilIdle())),
		graceTimeout,
	]);
	if (handles.some((h) => h.isRunning())) {
		logger.warn(
			"A scheduler tick is still in progress after grace period; continuing shutdown anyway",
		);
	} else {
		logger.info("Scheduler ticks (if any) finished cleanly");
	}
};
