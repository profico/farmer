# syntax=docker/dockerfile:1

# Production image for the public site (apps/site). Build from the repo root,
# because the frozen install needs the root lockfile:
#
#   docker build -f apps/site/Dockerfile -t farmer-site .
#   docker run --rm -p 3000:3000 farmer-site
#
# The site is prerendered at build time into static HTML. The runtime image
# holds that output and one small Bun file server (apps/site/server.ts), with
# no node_modules. The release data comes from the GitHub API during the build.
# Pass a token as the build secret `github_token` to avoid the anonymous rate
# limit (`--secret id=github_token,env=GITHUB_TOKEN`). The product image does
# not build or copy this workspace.

# Pin Bun to the same version as `packageManager` in package.json.
ARG BUN_VERSION=1.4.2

# ---- build: install the workspace and prerender the site ----
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app

# A frozen install refuses a lockfile whose workspaces are missing from the
# tree, so every workspace manifest is here, not only the site's.
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY apps/mobile/package.json apps/mobile/
COPY apps/push-relay/package.json apps/push-relay/
COPY apps/site/package.json apps/site/
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

COPY apps/site apps/site
# A failed read of the releases fails the build here, so a site never ships an
# empty Changelog by accident.
ENV SITE_STRICT_RELEASES=1
RUN --mount=type=secret,id=github_token \
    cd apps/site \
 && if [ -f /run/secrets/github_token ]; then export GITHUB_TOKEN="$(cat /run/secrets/github_token)"; fi \
 && bun run build

# ---- runtime: the built output and the file server, nothing else ----
FROM oven/bun:${BUN_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build /app/apps/site/dist/client ./dist/client
COPY --from=build /app/apps/site/server.ts ./server.ts
COPY --from=build /app/apps/site/src/lib/security-headers.ts ./src/lib/security-headers.ts

# Drop privileges: the oven/bun image ships a non-root `bun` user.
USER bun

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
	CMD bun -e "fetch('http://localhost:'+(process.env.PORT??3000)+'/_site/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "/app/server.ts"]
