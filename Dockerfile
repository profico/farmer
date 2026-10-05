# syntax=docker/dockerfile:1

# Production image for apps/web (TanStack Start) served by the Bun-native
# server at apps/web/server.ts. Build from the repo root:
#
#   docker build -t farmer-web .
#   docker run --rm -p 3000:3000 --env-file .env farmer-web
#
# Runtime config (DATABASE_URL, better-auth secrets, SMTP, …) is passed in as
# environment variables — never bake .env into the image (see .dockerignore).
# On boot the entrypoint applies pending DB migrations (RUN_MIGRATIONS=false to
# skip), then starts the server.
#
# --- Image strategy (why this is ~1/3 the size of a naive build) ---
# The app is compiled down to two self-contained bundles instead of shipping the
# full workspace + node_modules:
#   * vite build     → apps/web/dist  (client + SSR handler; `ssr.noExternal`
#                       bundles react/tanstack/base-ui/lucide/drizzle/postgres/…
#                       into dist/server, leaving only a handful of bare imports)
#   * bun build      → app.js         (server.ts + @farmer/core/jobs graph)
#                       migrate.js    (the standalone Drizzle migrator)
# The runtime image then installs only the packages that genuinely survive as
# bare imports (docker/runtime.package.json) — better-auth, framer-motion/motion,
# and the drizzle-orm + postgres peers of better-auth's adapter. No workspace
# node_modules, no source tree, no dev toolchain ship in the final image.

# Pin Bun to the same version as `packageManager` in package.json so the image
# resolves the lockfile identically to local installs.
ARG BUN_VERSION=1.4.2

# ---- build: install all workspace deps and produce the bundles ----
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# Copy only manifests first so `bun install` is cached until deps change.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
# The CLI is a workspace too, so the lockfile names it, and a frozen install
# refuses a lockfile whose workspaces are missing from the tree. Only the
# manifest is needed here: nothing from apps/cli is built into this image or
# shipped in the runtime stage below. Its binaries come from GitHub Releases
# (.github/workflows/cli-release.yml).
COPY apps/cli/package.json apps/cli/
# The same is true of the mobile app and its API client. Their manifests make
# this stage download the Expo dependencies, but nothing from either is built
# here, and the runtime stage below installs only docker/runtime.package.json,
# so the shipped image does not grow.
COPY apps/mobile/package.json apps/mobile/
COPY packages/api-client/package.json packages/api-client/
# Cap network concurrency and retry: the default 48 parallel requests saturate
# a shared/constrained builder (the Coolify arm64 host runs many containers and
# builds --no-cache, re-downloading everything each time), which has corrupted a
# tarball mid-extract and hung dependency resolution past a network timeout.
# Lower concurrency reduces the load; the retry rides out transient blips.
RUN attempts=0; until bun install --frozen-lockfile --network-concurrency 6; do \
      attempts=$((attempts + 1)); \
      if [ "$attempts" -ge 5 ]; then echo "bun install failed after $attempts attempts" >&2; exit 1; fi; \
      echo "bun install failed (attempt $attempts) — retrying in 10s..." >&2; sleep 10; \
    done

# Copy the rest of the sources and build.
# (node_modules / dist are excluded via .dockerignore, so this won't clobber
# the installed deps above.)
COPY . .

# 1) vite build → apps/web/dist/{client,server}
RUN cd apps/web && bun run build

# 2) bundle the Bun server (server.ts + the jobs graph it schedules) into a
#    single app.js. Keep external exactly what the runtime image provides:
#    - the prebuilt vite SSR handler, loaded at runtime from ./dist/server
#    - better-auth (its /tanstack-start subpath pulls @tanstack/start-server-core's
#      unbundleable #tanstack-* imports; leaving it external stops the bundler at
#      that boundary — the code path is never executed off the jobs/server graph)
RUN cd apps/web && bun build server.ts \
      --target=bun \
      --external "./dist/server/server.js" \
      --external "better-auth" --external "better-auth/*" \
      --external "framer-motion" \
      --external "#tanstack-router-entry" --external "#tanstack-start-entry" \
      --outfile /out/app.js

# 3) bundle the startup migrator. drizzle-orm + postgres bundle in.
#    DRIZZLE_MIGRATIONS_DIR (set by the entrypoint) points it at the shipped
#    drizzle/ SQL folder.
RUN cd apps/web && bun build ../../packages/core/src/db/migrate.ts \
      --target=bun \
      --outfile /out/migrate.js

# 4) bundle the site-wide task seed (Vacation, Sick Leave). It's idempotent
#    (onConflictDoNothing) and org-independent (scope: "site"), so the entrypoint
#    can safely run it on every boot. The demo seed (seed.ts) is intentionally
#    NOT bundled — it inserts non-idempotent demo data.
RUN cd apps/web && bun build ../../packages/core/src/db/seed-tasks.ts \
      --target=bun \
      --outfile /out/seed-tasks.js

# ---- runtime: bundles + minimal node_modules, nothing else ----
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000

# The commit this image was built from, shown at the foot of Settings. A plain
# environment variable rather than a VITE_ one for the reason every other flag
# here is: `vite build` runs inside this image, so a VITE_ value could only ever
# be what CI was given, baked for every environment the image is then deployed
# to. It lands in the RUNTIME stage only — passing it to the build stage would
# invalidate the dependency-install cache on every commit. Empty off CI, which
# the server reads as "unknown" and draws no line.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}
WORKDIR /app

# Pull the build artifacts first. These COPY --from=build lines also serialize
# this stage AFTER the build stage, so the minimal `bun install` below never
# races the build stage's full workspace install on the same builder (concurrent
# installs on an arm64 builder previously corrupted a platform-binary tarball).
COPY --from=build /out/app.js ./app.js
COPY --from=build /out/migrate.js ./migrate.js
COPY --from=build /out/seed-tasks.js ./seed-tasks.js
COPY --from=build /app/apps/web/dist ./dist
COPY --from=build /app/packages/core/drizzle ./drizzle
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh

# Install only the packages that survive as bare imports at runtime.
# The lockfile matters as much as the manifest. The six versions below are
# pinned exactly, but their transitive graph is not, so installing without one
# resolved it fresh on every build — two images built from the same commit could
# ship different code. docker/bun.lock is generated from this manifest and has
# to be regenerated when a version in it changes; runtime.package.json says how.
# It has to be written by THIS Bun: a newer Bun can write a lockfile version an
# older one cannot read (bun 1.4 writes lockfileVersion 2, which 1.3 answers
# with "Unknown lockfile version"), and the frozen install then fails. The root
# bun.lock is exempt only because bun keeps the version of a lockfile it is
# updating; this one is created from nothing every time.
COPY docker/runtime.package.json ./package.json
COPY docker/bun.lock ./bun.lock
RUN set -e; \
    attempts=0; until bun install --frozen-lockfile --network-concurrency 6; do \
      attempts=$((attempts + 1)); \
      if [ "$attempts" -ge 5 ]; then echo "bun install failed after $attempts attempts" >&2; exit 1; fi; \
      echo "bun install failed (attempt $attempts) — retrying in 10s..." >&2; sleep 10; \
    done; \
    rm -rf ~/.bun/install/cache

# Drop privileges — the oven/bun image ships a non-root `bun` user.
USER bun

EXPOSE 3000

# Liveness/readiness: the server must answer HTTP, not just have a live process.
# The start period is the budget for a slow migration and seed. During it,
# --start-interval probes every 2s and a failed probe does not count.
HEALTHCHECK --interval=30s --timeout=3s --start-period=120s --start-interval=2s --retries=3 \
	CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
