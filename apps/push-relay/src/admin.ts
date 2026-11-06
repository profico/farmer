/**
 * The relay operator's command line: mint, list, revoke and limit server keys.
 * It opens the same SQLite file as the relay (`RELAY_DB_PATH`). See README.md.
 */
import { runAdmin } from "./admin-cli";
import { DEFAULT_DB_PATH } from "./config";
import { DeviceStore } from "./store";

const store = DeviceStore.open(process.env.RELAY_DB_PATH || DEFAULT_DB_PATH);
try {
	for (const line of runAdmin(process.argv.slice(2), store, Date.now())) {
		console.log(line);
	}
} catch (cause) {
	console.error(cause instanceof Error ? cause.message : "unknown error");
	process.exitCode = 1;
} finally {
	store.close();
}
