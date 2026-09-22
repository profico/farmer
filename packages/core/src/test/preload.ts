// Closes the shared PGLite engine once, after every test file has finished.
//
// Loaded via `bunfig.toml`'s `[test] preload`, which is the only place a hook
// can be registered for the WHOLE run rather than for one file: `afterAll` here
// fires after the last file, not after each one.
//
// It exists because `harness.ts` deliberately keeps one engine alive across the
// suite (see the note there — per-file instances cost ~11GB and SIGKILL'd CI).
// Left open, that engine is a live handle at exit and `bun test` reports the
// run as failed with code 99 even though nothing failed, which is a red CI for
// a green suite. Closing it here is the other half of sharing it.

import { afterAll } from "bun:test";

import { closeTestEngine } from "./harness";

// The services seal stored credentials with a key derived from this
// (`lib/secret-box.ts`), and a fixture that inserts a plaintext token then
// exercises the reseal on read. A deployment always has it set; the suite has
// no `.env`, so it gets a fixed one here.
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-the-suite";

afterAll(async () => {
	await closeTestEngine();
});
