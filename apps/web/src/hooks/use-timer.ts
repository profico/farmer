import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { timerQuery } from "#/queries/timer.ts";

/**
 * The person's running timer, and the figure it shows (issue #59).
 *
 * One query for every surface — the sidebar row, the mobile bar, the Time page
 * — in the shape of `use-unfiled-count.ts`: not a suspense query, never awaited
 * by a loader, so a navigation paints before the timer arrives.
 *
 * The elapsed figure is drawn in the browser between fetches, and against the
 * server's own clock rather than the machine's: `serverNow` and `startedAt`
 * come from the same read, so their difference is what the server measured. A
 * laptop five minutes fast would otherwise count five minutes the server will
 * not agree to, and the figure would jump when the entry was saved.
 */
export function useTimer(orgSlug: string) {
	const { data: timer, isPending } = useQuery(timerQuery(orgSlug));
	const running = timer != null && timer.droppedAt == null;
	const [browserNow, setBrowserNow] = useState(() => Date.now());

	useEffect(() => {
		if (!running) return;
		setBrowserNow(Date.now());
		const id = setInterval(() => {
			setBrowserNow(Date.now());
		}, 1000);
		return () => {
			clearInterval(id);
		};
	}, [running]);

	if (!timer) return { timer: null, elapsedSeconds: 0, isPending };

	// The figure is the difference between two instants, never a counter: a tab
	// that slept for an hour shows the hour when it wakes.
	const drift = running
		? Math.max(0, browserNow - timer.serverNow.getTime())
		: 0;

	return {
		timer,
		elapsedSeconds: timer.elapsedSeconds + Math.round(drift / 1000),
		isPending,
	};
}
