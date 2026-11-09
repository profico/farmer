# apps/site

This workspace holds the public site of Profico farmer. The front page, the about page, the changelog, the self-hosting guide and the legal pages are here. Read the root `CLAUDE.md` first for the commands and the lint rules.

```bash
bun run dev        # vite dev --port 3100, with a proxy to the web dev server
bun run build      # fetch the releases, then vite build with prerender
bun run start      # bun run server.ts: the static host for dist/client
bun run test       # bun test
```

## What the site is

- The site is prerendered. `vite build` writes one `index.html` for each page in `dist/client`. The page list is `SITE_PAGES` in `vite.config.ts`. A new route needs an entry in that list.
- The site is static. The host (`server.ts`) only serves files. It has no server rendering and no API.
- The site has no server function. Do not use `createServerFn` here.
- The site does not use `@farmer/core`, and it has no database. If you need a small helper from core, copy it.
- The site is a copy of the pages that were in `apps/web`. The two apps do not share code. If a design token changes in `apps/web/src/styles.css`, change it in `src/styles.css` too.

## Links and assets

- A link between site pages can use `<Link>`.
- A link that leaves the site is a plain `<a href>`. This includes `/_`, `/login`, `/api-docs`, `/cli` and `/device`. The web app owns these paths, so the site router must not know them.
- The call-to-action is `SiteCta` in `components/site/site-chrome.tsx`. It links to `/_`. The web app resolves `/_` to the workspace, to `/login` or to `/no-access`. The site never reads a session.
- Built files go to `/_site/` (`build.assetsDir` in `vite.config.ts`). Files from `public/` also go under `public/_site/`. The web app owns `/assets/*`, and the site must not use that path.
- The site uses these files of the web app on the same origin: `/Icon.svg` and `/manifest.json`. The og image is `/_site/og.png`.
- A new top-level site route must be in `RESERVED_SLUGS` (`packages/core/src/lib/slug.ts`). `apps/web/src/lib/reserved-slugs.test.ts` reads the route files of this workspace and checks it.

## Release data

- The changelog and the front page show releases and commits of `profico/farmer`. The site does not call GitHub at run time.
- `scripts/fetch-releases.ts` reads the GitHub API and writes `src/generated/releases.json`. `bun run build` runs it first, but the script does nothing unless `SITE_FETCH_RELEASES=1`. The script uses `GITHUB_TOKEN` when it is set.
- On a network error or a rate limit, the script prints a warning and writes empty data. With `SITE_STRICT_RELEASES=1` it exits with an error. The image build sets both variables.
- The repository holds an empty stub of `releases.json`, so typecheck, tests and the CI build pass without a network. A plain local build keeps the stub. Do not commit real data. If you set `SITE_FETCH_RELEASES=1` locally, run `git checkout` on the file after the build.
- The parse step reads `cli-v*` tags as CLI releases and `mobile-v*` tags as mobile releases. It leaves out `mobile-latest`, because that tag moves to each new build. A mobile release body lists every commit since the last build, so its notes are only the `(mobile)` lines under `## Changes`.
- `commitKind` reads the type and the scope of a commit subject. `(mobile)` is the mobile app and `(cli)` is the CLI. `ci`, `(deps…)` and `(site)` are internal. All other commits are the web app.
- The Web filter groups the web commits by day. The Mobile and CLI filters show the releases, so their commits do not show as days.
- The front page pill shows the date of the newest web commit.
- `src/lib/release-notes.ts` has the shapes and the parsing. `src/lib/releases.ts` reads the JSON file.
- The site shows the commits on `main`. It does not show which build runs.

## Dev

`vite dev` serves the site on port 3100. The proxy in `vite.config.ts` sends the paths that the app owns to the web dev server on port 3000: `/_` (exact), `/_/`, `/login`, `/api`, `/api-docs`, `/cli`, `/device`, `/Icon.svg` and `/manifest.json`. It does not proxy `/_site`. Start `apps/web` too, or these links show an error.

## Deploy

- `apps/site/Dockerfile` builds the image. The final stage has only `dist/client` and the files that `server.ts` needs. The product `Dockerfile` does not build this workspace, and its runtime stage does not hold it. Its build stage copies the whole tree with `COPY . .`, and it copies `apps/site/package.json` early, for the frozen install.
- The CI job `site-image` in `.github/workflows/ci.yml` builds and pushes `ghcr.io/<owner>/farmer-site`. It calls the Coolify webhook `COOLIFY_SITE_WEBHOOK` when the secret exists.
- Both deployments use the domain `farmer.profi.co`. The web app owns the domain in Coolify. A Coolify domain path is a string prefix: `/about` would also catch `/about-1/...`, and the reserved-slug fallback can create the slug `about-1`. So the site does not use a domain path. It gets one Traefik router from a Coolify dynamic configuration, with this rule:

  ```
  Host(`farmer.profi.co`) && (Path(`/`) || PathRegexp(`^/(about|changelog|self-hosting|early-access|privacy|terms|delete-account)/?$`) || PathPrefix(`/_site/`))
  ```

  The site has 8 routes: `/` and the 7 pages in the expression. `apps/site/traefik.example.yml` holds a complete example (router, service, priority, TLS). `server.test.ts` checks that the expression matches the route files. Everything else goes to the web app, for example `/_`, `/Icon.svg`, `/manifest.json` and `/robots.txt`.
- These URLs must not change: `/delete-account` (the Play listing) and `/privacy` (the mobile app).
- `/_site/health` answers 200 for the health check.
- `server.ts` sends the baseline security headers (`src/lib/security-headers.ts`, a copy of the web file).

## Not in the site

- PostHog. The app sends its events through its own proxy path, and the site has no analytics.
- The custom palette, the scale and the font choice of Preferences → Display. The site follows light and dark, "High contrast", "Boring font" and "Less movement" from the same localStorage keys as the app.
