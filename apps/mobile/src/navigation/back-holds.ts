let holds = 0;
const listeners = new Set<() => void>();

/** The number of open holds. */
export const holdCount = (): number => holds;

/** Calls `listener` each time a hold opens or closes. Returns the stop. */
export function subscribeHolds(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Tells the app that some code wants the Back event, for example a
 * `BackHandler` listener. While a hold is open, the app keeps the Back
 * gesture and Android does not play the back-to-home preview. Nothing calls
 * this yet. It stays as the documented way for a future `BackHandler` user
 * to keep the gesture. Call the
 * returned function to release the hold. Expo Router's own listener needs no
 * hold: `useSystemBack` reads the router state for it.
 */
export function holdBack(): () => void {
	holds += 1;
	for (const listener of listeners) listener();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holds -= 1;
		for (const listener of listeners) listener();
	};
}

/** Whether Android may handle Back: the router has nothing to go back to and
 *  no code holds the event. */
export function systemMayHandleBack(
	canGoBack: boolean,
	openHolds: number,
): boolean {
	return !canGoBack && openHolds === 0;
}
