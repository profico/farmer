# Provenance

Vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).

| | |
|---|---|
| Upstream commit | `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (10 Sep 2026) |
| Upstream path | `src/` |
| Synced on | 17 Sep 2026 |
| Previous sync | `5bca7155bfc338bc77a94f588921e9036a33b5ce` (31 Aug 2026), vendored in `1d88e9f` |

Upstream tests (`*.test.ts`) are not vendored. Everything else under `src/` is
copied verbatim, so a re-sync stays a diff.

## Local amendments

One file departs from upstream. It carries a `Local amendment to the upstream
rule` comment saying why. Read the comment before you "fix" it back.

- `rules/no-unknown-parameters.ts` — a promise rejection handler's parameter is
  `unknown` because `useUnknownInCatchVariables` makes it so, not because a
  boundary went unparsed. Treated like the `cause` exception upstream already
  carves out.

Two earlier amendments were dropped at the 17 Sep 2026 sync because upstream now
covers both cases itself:

- Zod's `.shape` — upstream `no-shape-in-symbol-names` added
  `isBorrowedMemberName`, which exempts a member read the repo does not own.
- A leading comment on an `export const` — upstream
  `require-safety-comment-for-type-assertion` now walks to the
  `ExportNamedDeclaration` before giving up.

## Rules vendored but not registered

`oxlint.config.ts` enables all 18 generic rules. Only `effect/` stays
unregistered: this repo does not use Effect, so its entry point is absent from
`jsPlugins`. The files are vendored anyway so a re-sync stays a plain diff.

`rules/require-readable-spacing.ts` carries `vendor/eslint-stylistic/` with it —
a port of `padding-line-between-statements`, Apache-2.0, provenance in
`vendor/eslint-stylistic/UPSTREAM.md`. It was turned on at the 17 Sep 2026 sync
and its 6386 findings were fixed with `oxlint --fix` in the same change. The
blank lines it adds survive `oxfmt --write`, so the two tools do not fight.
