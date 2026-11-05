import { relayIdHint } from "../ids";
import type { Log, Sender } from "./types";

/**
 * The sender for a platform with no credentials. It logs one line and sends
 * nothing, so the relay can run before the Apple and Google accounts exist.
 * The line holds the kind and the sizes, never the ciphertext or a token.
 */
export const dryRunSender =
	(log: Log): Sender =>
	async (device, push) => {
		const parts = [
			"[push-relay] dry-run",
			`platform=${device.platform}`,
			`relay=${relayIdHint(device.relayId)}`,
			`kind=${push.kind}`,
			`ciphertextLength=${push.ciphertext.length}`,
		];
		if (push.liveActivity) {
			parts.push(
				`event=${push.liveActivity.event}`,
				`target=${push.liveActivity.token ? "activity" : "push-to-start"}`,
			);
		}
		log(parts.join(" "));
		return { outcome: "dry_run" };
	};
