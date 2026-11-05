# syntax=docker/dockerfile:1

# Production image for the push relay (apps/push-relay). Build from the repo
# root, because the frozen install needs the root lockfile:
#
#   docker build -f apps/push-relay/Dockerfile -t farmer-push-relay .
#   docker run --rm -p 3000:3000 -v relay-data:/data farmer-push-relay
#
# The APNs key and the FCM service account come in as environment variables
# at runtime (see apps/push-relay/README.md). Never bake them into the image.
#
# The relay compiles to one file with `bun build`. Zod goes into the bundle,
# and bun:sqlite is part of Bun, so the runtime image has no node_modules.

# Pin Bun to the same version as `packageManager` in package.json.
ARG BUN_VERSION=1.4.2

# ---- build: install the workspace and bundle the relay ----
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# A frozen install refuses a lockfile whose workspaces are missing from the
# tree, so every workspace manifest is here, not only the relay's.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY apps/mobile/package.json apps/mobile/
COPY apps/push-relay/package.json apps/push-relay/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/push-crypto/package.json packages/push-crypto/
# The same retry loop as the root Dockerfile, for the same reason: a shared
# builder has corrupted a tarball and hung an install before.
RUN attempts=0; until bun install --frozen-lockfile --network-concurrency 6; do \
      attempts=$((attempts + 1)); \
      if [ "$attempts" -ge 5 ]; then echo "bun install failed after $attempts attempts" >&2; exit 1; fi; \
      echo "bun install failed (attempt $attempts) — retrying in 10s..." >&2; sleep 10; \
    done

COPY apps/push-relay apps/push-relay
RUN cd apps/push-relay && bun build src/main.ts --target=bun --outfile /out/relay.js

# ---- runtime: one bundle, nothing else ----
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV RELAY_DB_PATH=/data/relay.sqlite
WORKDIR /app

COPY --from=build /out/relay.js ./relay.js

# The SQLite file lives on a volume, so a new image keeps the devices. The
# directory must belong to the non-root user before VOLUME declares it.
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data

# Drop privileges: the oven/bun image ships a non-root `bun` user.
USER bun

EXPOSE 3000

# /healthz answers only when the database answers a query.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
	CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "/app/relay.js"]
