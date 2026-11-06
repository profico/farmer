/**
 * The push relay's process: read the environment, open the database, pick a
 * sender for each platform, and serve. See README.md.
 */
import { createRelay } from "./app";
import { MAX_BODY_BYTES } from "./body";
import { trustedIpHeader } from "./client-address";
import { readConfig } from "./config";
import { ApnsTokenCache, apnsSender } from "./delivery/apns";
import { dryRunSender } from "./delivery/dry-run";
import { FcmTokenCache, fcmSender, fetchPost } from "./delivery/fcm";
import { createHttp2Transport } from "./delivery/http2";
import type { Log, Sender } from "./delivery/types";
import { startPruning } from "./prune";
import { createLimiters, DEFAULT_LIMITS } from "./rate-limit";
import { DeviceStore } from "./store";

const log: Log = (line) => console.log(line);
const now = () => Date.now();

const config = readConfig(process.env);
const store = DeviceStore.open(config.dbPath);
const stopPruning = startPruning(store, now, log);

let ios: Sender = dryRunSender(log);
if (config.apns) {
	const tokens = new ApnsTokenCache(config.apns, now);
	await tokens.verifyKey();
	ios = apnsSender(config.apns, tokens, createHttp2Transport(), now);
} else {
	log("[push-relay] no APNs credentials: iOS pushes are a dry run");
}

let android: Sender = dryRunSender(log);
if (config.fcm) {
	const tokens = new FcmTokenCache(config.fcm, fetchPost, now);
	await tokens.verifyKey();
	android = fcmSender(config.fcm, tokens, fetchPost);
} else {
	log("[push-relay] no FCM credentials: Android pushes are a dry run");
}

const clientHeader = trustedIpHeader(config.trustedIpHeader);
log(
	clientHeader
		? `[push-relay] client address from the header ${clientHeader}`
		: "[push-relay] client address from the socket (TRUSTED_IP_HEADER is none or empty)",
);

log(
	config.requireServerKey
		? "[push-relay] a push needs a server key"
		: "[push-relay] REQUIRE_SERVER_KEY is off: a push with no server key still works",
);

const relay = createRelay({
	store,
	senders: { ios, android },
	limiters: createLimiters(DEFAULT_LIMITS),
	trustedIpHeader: clientHeader,
	maxDevices: config.maxDevices,
	requireServerKey: config.requireServerKey,
	log,
	now,
});

const server = Bun.serve({
	port: config.port,
	// Bun closes a connection that is idle for this many seconds (default
	// 10), also while a handler waits on APNs or FCM. It must stay above the
	// longest push deadline (10 s for one APNs or FCM call).
	idleTimeout: 60,
	// The handler reads at most MAX_BODY_BYTES too; this stops a large body
	// before it reaches the handler.
	maxRequestBodySize: MAX_BODY_BYTES * 2,
	fetch: (request, bunServer) =>
		relay(request, bunServer.requestIP(request)?.address ?? null),
	error: (cause) => {
		log(`[push-relay] unhandled error: ${cause.message}`);
		return Response.json({ error: "internal" }, { status: 500 });
	},
});

log(`[push-relay] listening on port ${server.port}`);

const shutdown = () => {
	stopPruning();
	void server.stop().then(() => {
		store.close();
		process.exit(0);
	});
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
