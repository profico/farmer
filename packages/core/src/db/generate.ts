// `db:generate`: run `drizzle-kit generate`, then keep only the newest snapshot.
//
// A script of the form "a && b" does not work here. `bun run db:generate --name x`
// adds `--name x` to the last command, so drizzle-kit never gets it.
// drizzle-kit also asks about renamed columns, so it gets the terminal.
import { pruneSnapshots } from "./prune-snapshots";

const proc = Bun.spawn(["drizzle-kit", "generate", ...Bun.argv.slice(2)], {
	stdio: ["inherit", "inherit", "inherit"],
});
const code = await proc.exited;
if (code !== 0) process.exit(code);

await pruneSnapshots();
