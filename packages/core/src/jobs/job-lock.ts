/**
 * A cross-instance lock for one tick of one job.
 *
 * Two replicas of the web container each run every scheduler. A tick takes a
 * Postgres advisory lock first, and only the instance that gets the lock runs
 * the tick. The other instance skips the tick and tries again on its next one.
 *
 * The lock is session-level, so it lives on one connection. The pool must not
 * hold it: the pool may give the next query a different connection, and the
 * lock would stay on the first one. Each tick reserves one connection, takes
 * the lock on it, runs the job on the pool as before, then unlocks and
 * releases the connection in a `finally`. A dead process or a dropped
 * connection frees the lock on the server, so a crash cannot stall a job.
 *
 * The key is `hashtextextended` of the job name, so each job has its own lock
 * and the key is derived here and nowhere else. The migration lock in
 * `db/migrate.ts` is a fixed constant and cannot collide in practice.
 */

import { ambientSqlClient } from "../db";
import { loggableErrorLine } from "../lib/loggable-error";

/** Returns a release function, or null when another session holds the lock. */
export type TryJobLock = (
	jobName: string,
) => Promise<(() => Promise<void>) | null>;

const lockName = (jobName: string): string => `farmer:job:${jobName}`;

export const tryPostgresJobLock: TryJobLock = async (jobName) => {
	const client = ambientSqlClient();
	// A test handle (PGLite) has one connection, so a session lock could never
	// exclude anyone there.
	if (client === null) return async () => {};
	const connection = await client.reserve();
	try {
		const rows = await connection<
			Array<{ locked: boolean }>
		>`select pg_try_advisory_lock(hashtextextended(${lockName(jobName)}, 0)) as locked`;
		if (rows[0]?.locked !== true) {
			connection.release();
			return null;
		}
	} catch (error) {
		connection.release();
		throw error;
	}
	return async () => {
		try {
			await connection`select pg_advisory_unlock(hashtextextended(${lockName(jobName)}, 0))`;
		} catch (error) {
			// The tick already did its work: a failed unlock must not turn it into a
			// failure. The lock frees when the pool closes this idle connection.
			console.error(
				`[job-lock] unlock failed for ${jobName}: ${loggableErrorLine(error)}`,
			);
		} finally {
			connection.release();
		}
	};
};

export type JobLockResult<T> = { ran: true; value: T } | { ran: false };

/** Run `fn` only if this instance gets the job's lock; the lock is released
 *  whether `fn` returns or throws. */
export const withJobLock = async <T>(
	jobName: string,
	fn: () => Promise<T>,
	tryLock: TryJobLock = tryPostgresJobLock,
): Promise<JobLockResult<T>> => {
	const release = await tryLock(jobName);
	if (release === null) return { ran: false };
	try {
		return { ran: true, value: await fn() };
	} finally {
		await release();
	}
};
