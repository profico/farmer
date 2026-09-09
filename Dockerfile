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
# the drizzle-orm + postgres peers of better-auth's adapter, and the native typst
# compiler (which can't be bundled) — pruned to the target arch. No workspace
# node_modules, no source tree, no dev toolchain ship in the final image.

# Pin Bun to the same version as `packageManager` in package.json so the image
# resolves the lockfile identically to local installs.
ARG BUN_VERSION=1.3.14

# ---- build: install all workspace deps and produce the bundles ----
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# Copy only manifests first so `bun install` is cached until deps change.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
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
#    - the native typst compiler (NAPI .node binaries can't be bundled)
RUN cd apps/web && bun build server.ts \
      --target=bun \
      --external "./dist/server/server.js" \
      --external "@myriaddreamin/typst-ts-node-compiler" \
      --external "better-auth" --external "better-auth/*" \
      --external "framer-motion" \
      --external "#tanstack-router-entry" --external "#tanstack-start-entry" \
      --outfile /out/app.js

# 3) bundle the startup migrator. drizzle-orm + postgres bundle in; only the
#    typst dep (reached transitively) stays external. DRIZZLE_MIGRATIONS_DIR
#    (set by the entrypoint) points it at the shipped drizzle/ SQL folder.
RUN cd apps/web && bun build ../../packages/core/src/db/migrate.ts \
      --target=bun \
      --external "@myriaddreamin/typst-ts-node-compiler" \
      --outfile /out/migrate.js

# 4) bundle the site-wide task seed (Vacation, Sick Leave). It's idempotent
#    (onConflictDoNothing) and org-independent (scope: "site"), so the entrypoint
#    can safely run it on every boot. The demo seed (seed.ts) is intentionally
#    NOT bundled — it inserts non-idempotent demo data.
RUN cd apps/web && bun build ../../packages/core/src/db/seed-tasks.ts \
      --target=bun \
      --external "@myriaddreamin/typst-ts-node-compiler" \
      --outfile /out/seed-tasks.js

# ---- runtime: bundles + minimal node_modules, nothing else ----
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
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

# Install only the packages that survive as bare imports at runtime, then drop
# every typst platform binary except the one for THIS build's arch (~50MB each).
# The triple is auto-detected from the build platform so the image just works on
# arm64 or x64 without a build-arg — the runtime stage runs on the target arch
# (true for a plain `docker build` and for buildx --platform under QEMU). libc is
# always gnu because the -slim base is Debian (glibc); switching to an Alpine
# base would need the -musl triple instead. Override explicitly if needed with
# --build-arg TARGET_TYPST_TRIPLE=linux-x64-gnu.
ARG TARGET_TYPST_TRIPLE=""
# The lockfile matters as much as the manifest. The six versions below are
# pinned exactly, but their transitive graph is not, so installing without one
# resolved it fresh on every build — two images built from the same commit could
# ship different code. docker/bun.lock is generated from this manifest and has
# to be regenerated when a version in it changes; runtime.package.json says how.
# It has to be written by THIS Bun: a lockfile from bun 1.4 is lockfileVersion 2
# and 1.3.14 answers it with "Unknown lockfile version", then fails the frozen
# install. The root bun.lock is exempt only because bun keeps the version of a
# lockfile it is updating; this one is created from nothing every time.
COPY docker/runtime.package.json ./package.json
COPY docker/bun.lock ./bun.lock
RUN set -e; \
    attempts=0; until bun install --frozen-lockfile --network-concurrency 6; do \
      attempts=$((attempts + 1)); \
      if [ "$attempts" -ge 5 ]; then echo "bun install failed after $attempts attempts" >&2; exit 1; fi; \
      echo "bun install failed (attempt $attempts) — retrying in 10s..." >&2; sleep 10; \
    done; \
    triple="${TARGET_TYPST_TRIPLE}"; \
    if [ -z "$triple" ]; then \
      case "$(uname -m)" in \
        aarch64|arm64) triple="linux-arm64-gnu" ;; \
        x86_64|amd64)  triple="linux-x64-gnu" ;; \
        *) echo "unsupported arch $(uname -m); set --build-arg TARGET_TYPST_TRIPLE" >&2; exit 1 ;; \
      esac; \
    fi; \
    echo "[typst] keeping platform binary: $triple"; \
    find node_modules/@myriaddreamin -maxdepth 1 \
         -name 'typst-ts-node-compiler-*' ! -name "*-${triple}" \
         -exec rm -rf {} + ; \
    test -d "node_modules/@myriaddreamin/typst-ts-node-compiler-${triple}" \
      || { echo "[typst] no binary for ${triple} after prune" >&2; exit 1; }; \
    rm -rf ~/.bun/install/cache

# Drop privileges — the oven/bun image ships a non-root `bun` user.
USER bun

EXPOSE 3000

# Liveness/readiness: the server must answer HTTP, not just have a live process.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
	CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
