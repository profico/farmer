# Vendored oxlint plugins

`oxlint.config.ts` at the root loads both plugins. They are vendored, not depended on, so these files are ours to edit.

## anti-slop

From [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop): fifteen rules that reject low-evidence TypeScript — `unknown` in a contract, a `Record<string, unknown>` value type, a hand-rolled `typeof` narrowing where a parse belongs, a type assertion with no stated invariant. All `error`, and the tree is clean of them.

Three anti-slop rules carry a `Local amendment to the upstream rule` comment saying why (Zod's `.shape`; a `.catch()` handler's parameter is `unknown`; leading comments on an `export const` attach to the ExportNamedDeclaration). Read the comment before "fixing" one back.

## stella

From [stella's `.oxlint-plugins`](https://github.com/stella/stella/tree/main/.oxlint-plugins), Apache-2.0: `no-vacuous-throw-assertion` (an argument-less `.toThrow()` passes for any thrown value), `no-document-cookie`, `require-suppression-description`, `no-foreign-directive` and `no-partial-record-satisfies`. The other ~126 upstream rules were measured against this repo and skipped: domain-specific, already covered, or already passing.

Provenance for the stella rules is in `stella/index.ts`, so a re-sync stays a diff.
