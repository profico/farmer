#!/bin/sh
# Container entrypoint: apply pending DB migrations, then start the server.
#
# Migrations run here (not baked into the image) because they need the live
# DATABASE_URL, which is only present at runtime. The migrator is idempotent —
# it applies only unapplied migrations — so re-running on every boot is safe.
# On multi-replica boots, migrate.js (packages/core/src/db/migrate.ts) itself
# serializes concurrent migrators with a Postgres session-level advisory lock
# (pg_advisory_lock) around the migration run, so replicas that start at the
# same time queue up on one connection instead of racing each other.
#
# Set RUN_MIGRATIONS=false to skip entirely (e.g. when migrations are handled
# by a separate deploy job).
#
# app.js / migrate.js are the bundled artifacts produced by `bun build` in the
# Dockerfile; DRIZZLE_MIGRATIONS_DIR points the bundled migrator at the shipped
# drizzle/ SQL folder. app.js loads the vite SSR handler from ./dist/server
# relative to the working directory, so run from /app.
set -e
cd /app

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
	echo "[entrypoint] running database migrations..."
	DRIZZLE_MIGRATIONS_DIR=/app/drizzle bun run /app/migrate.js
else
	echo "[entrypoint] RUN_MIGRATIONS=false — skipping migrations"
fi

# Seed the site-wide default entry types. Idempotent (onConflictDoNothing), so
# re-running on every boot is safe; set RUN_SEED=false to skip. Runs after
# migrations so the task table exists. This is only the two built-in absence
# tasks — the demo seed (client/project/tasks) is never run automatically.
if [ "${RUN_SEED:-true}" = "true" ]; then
	echo "[entrypoint] seeding built-in tasks..."
	bun run /app/seed-tasks.js
else
	echo "[entrypoint] RUN_SEED=false — skipping seed"
fi

echo "[entrypoint] starting server..."
exec bun run /app/app.js
