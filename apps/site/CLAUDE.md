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
- `scripts/fetch-releases.ts` reads the GitHub API and writes `src/generated/releases.json`. `bun run build` runs it first. The script uses `GITHUB_TOKEN` when it is set.
- On a network error or a rate limit, the script prints a warning and writes empty data. With `SITE_STRICT_RELEASES=1` it exits with an error. The image build sets this variable.
- The repository holds an empty stub of `releases.json`, so typecheck and tests pass without a network. Do not commit real data. Run `git checkout` on the file after a local build.
- `src/lib/release-notes.ts` has the shapes and the parsing. `src/lib/releases.ts` reads the JSON file.
- The site shows the commits on `main`. It does not show which build runs.

## Dev

`vite dev` serves the site on port 3100. The proxy in `vite.config.ts` sends the paths that the app owns to the web dev server on port 3000: `/_` (exact), `/_/`, `/login`, `/api`, `/api-docs`, `/cli`, `/device`, `/Icon.svg` and `/manifest.json`. It does not proxy `/_site`. Start `apps/web` too, or these links show an error.

## Deploy

- `apps/site/Dockerfile` builds the image. The final stage has only `dist/client` and the files that `server.ts` needs. The product `Dockerfile` does not build or copy this workspace. It copies only `apps/site/package.json`, for the frozen install.
- The CI job `site-image` in `.github/workflows/ci.yml` builds and pushes `ghcr.io/<owner>/farmer-site`. It calls the Coolify webhook `COOLIFY_SITE_WEBHOOK` when the secret exists.
- Both deployments use the domain `farmer.profi.co`. A path rule in the proxy (Coolify) sends the site paths to this image and all other paths to the web image. The site paths are `/`, the eight pages and `/_site/*`. These URLs must not change: `/delete-account` (the Play listing) and `/privacy` (the mobile app).
- `/_site/health` answers 200 for the health check.
- `server.ts` sends the baseline security headers (`src/lib/security-headers.ts`, a copy of the web file).

## Not in the site

- PostHog. The app sends its events through its own proxy path, and the site has no analytics.
- The custom palette, the scale and the font choice of Preferences → Display. The site follows light and dark, "High contrast", "Boring font" and "Less movement" from the same localStorage keys as the app.
