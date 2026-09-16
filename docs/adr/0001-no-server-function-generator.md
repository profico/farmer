# 0001 — Server functions stay one hand-written declaration each

**Status:** Accepted
**Date:** 2026-08-11

## Context

`apps/web/src/server/*.ts` holds 164 server functions across 23 modules, and the
overwhelming majority are forwarders with an identical body:

```ts
export const listClients = createServerFn({ method: "GET" })
  .middleware([orgMiddleware])
  .handler(async ({ context }) => {
    const { clientsService } = await import("@farmer/core/services");
    return clientsService.list(context.ctx);
  });
```

Method, middleware, validator, service, method name. Five facts, twelve lines,
repeated 164 times — and each one is paired with a query factory in
`apps/web/src/queries/` that repeats the key and the call.

The obvious deepening is a `defineOperation({ method, middleware, input, service,
call })` that emits the server function, the query factory and the key from one
declaration. This ADR records why that is not possible here, so it does not get
proposed again.

## Decision

Server functions remain one hand-written `export const x = createServerFn()…`
per operation. The declaration is not wrapped, generated, or produced by a
factory.

## Why

The TanStack Start compiler (`@tanstack/start-plugin-core`, a transitive
dependency of `@tanstack/react-start`) transforms server functions at **build
time, by syntactic AST match** — not via a `"use server"` directive. Three
constraints make a factory impossible rather than merely awkward:

1. **It matches a `.handler(` member-expression chain rooted at an imported
   `createServerFn`,** and in the common case takes a fast path that walks only
   `ast.program.body`, inspecting top-level `VariableDeclaration` nodes. A chain
   inside `export function defineOperation()` is never descended into.
2. **The chain must be the initializer of a top-level variable declarator.** The
   handler throws `createServerFn must be assigned to a variable!`, and the
   generated function id is derived from that variable's name plus the file
   path — the identity is structurally tied to the declaration site.
3. **The split is per-module and static.** The module is recompiled as a
   server-only "provider" with every export stripped except the extracted
   handler, and the client copy has the handler replaced by an RPC stub keyed by
   id. One lexical `createServerFn(...).handler(...)` site therefore yields
   exactly one server function, no matter how many times a factory wrapping it
   is called — and the per-call-site config (validator, middleware, which
   service to call) lives in the *caller's* module and is never serialized
   across the boundary.

The failure mode is the dangerous one. If the helper module contains nothing but
`createServerFn`, the fast path finds no top-level candidate and **bails
silently**: no build error, no registered server function, and the untransformed
chain ships to the browser where `handler` receives one argument instead of two
and runs the server body client-side. That is the same silent class as the
static-`@farmer/core/db`-import hydration crash documented in `apps/web/CLAUDE.md` — it
passes typecheck, lint and build. If the same file happens to also mention
`createMiddleware` or `createIsomorphicFn`, the full traversal runs instead and
it becomes a hard build error. Which of the two you get depends on unrelated
contents of the file.

## What was done instead

The half of the duplication that is ordinary runtime code was collapsed:
`apps/web/src/queries/keys.ts` holds the root of every query-key family, every
factory spreads its root from there, and every invalidation names the same root
instead of a bare string literal. That removes the prose-enforced invariant
("kept under the `time-entries` key prefix so the existing invalidations already
refresh it") — the invariant is now written in the code that depends on it.

## Consequences

- Adding an operation stays five lines of boilerplate. Accepted.
- Factoring out the *pieces* is still fine and encouraged: shared
  `createMiddleware()` instances, shared Zod validators, shared service
  functions the inline handler calls. Only wrapping the chain itself is
  forbidden.
- If TanStack Start moves to directive-based (`"use server"`) extraction, this
  decision is worth revisiting — the blocker is the syntactic transform, not the
  idea.
