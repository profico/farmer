import type { Timer } from "@farmer/api-client";
import { useEffect, useState } from "react";

/**
 * The stopwatch figure, ticking once a second while the timer runs.
 *
 * It counts from the moment the answer arrived, not from the phone's clock
 * against `startedAt`: a phone whose clock is wrong would otherwise count
 * minutes the server will not agree to. A held timer stands still.
 */
export const useElapsed = (timer: Timer | null, receivedAt: number) => {
	const [now, setNow] = useState(() => Date.now());
	const running = timer !== null && !timer.paused && !timer.droppedAt;

	useEffect(() => {
		if (!running) return;
		const interval = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(interval);
	}, [running]);

	if (!timer) return 0;
	if (!running) return timer.elapsedSeconds;
	return timer.elapsedSeconds + Math.max(0, (now - receivedAt) / 1000);
};
