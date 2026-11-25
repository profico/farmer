import { useSyncExternalStore } from "react";

// The way in to the Rewind: the sidebar row and the phone's More sheet. Each
// stands out until this device opens that year's Rewind once.

export const REWIND_GRADIENT =
	"linear-gradient(115deg, #5b3aa8 0%, #22418f 62%, #cf553f 100%)";

const CHANGE_EVENT = "farmer:rewind-seen";
const keyFor = (year: number) => `farmer:rewind-seen:${year}`;

const read = (year: number) => {
	try {
		return localStorage.getItem(keyFor(year)) === "1";
	} catch {
		return true;
	}
};

const subscribe = (onChange: () => void) => {
	window.addEventListener(CHANGE_EVENT, onChange);
	window.addEventListener("storage", onChange);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onChange);
		window.removeEventListener("storage", onChange);
	};
};

export function markRewindSeen(year: number) {
	if (read(year)) return;
	try {
		localStorage.setItem(keyFor(year), "1");
	} catch {
		// Storage refused the write: the row stays bright, which costs nothing.
	}
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Server-renders as seen, so a person who opened it never sees a flash. */
export function useRewindSeen(year: number | null) {
	return useSyncExternalStore(
		subscribe,
		() => year === null || read(year),
		() => true,
	);
}
