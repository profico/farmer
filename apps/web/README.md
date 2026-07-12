# web

The Farmer web app — TanStack Start (React 19) with file-based routing, TanStack Query, and shadcn components on Base UI. All business logic lives in [`packages/core`](../../packages/core); this app is routes, server functions, and UI.

See the [root README](../../README.md) for setup. App-specific scripts:

```bash
bun run dev     # vite dev server on :3000
bun run build   # vite build → dist/{client,server}
bun run start   # production server (server.ts serves dist/)
bun run test    # vitest
bun run check   # biome lint + format
```

There is no hosting preset — `server.ts` *is* the production server. See "Deploying" in the root README.
