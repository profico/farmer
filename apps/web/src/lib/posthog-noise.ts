import { z } from "zod";

/**
 * The one browser error that is not a fault. `useScrollFade` writes the
 * scrollbar's width into `.page-scroll`'s padding from inside its
 * ResizeObserver callback, on purpose — the bar and the narrower padding then
 * paint in the same frame — and that write resizes the children the callback
 * was just told about. The browser delivers those sizes a frame later and says
 * so on `window` with this message, which `capture_unhandled_errors` would
 * otherwise record each time a page's bar comes or goes.
 */
const RESIZE_OBSERVER_LOOP =
	"ResizeObserver loop completed with undelivered notifications.";

const exceptionValues = z.array(z.object({ value: z.string().optional() }));

/** The part of a PostHog event this reads. The SDK types every property as
 *  `any`, so the list is still parsed here rather than trusted. */
type CapturedEvent = {
	event: string;
	properties: { $exception_list?: z.input<typeof exceptionValues> };
};

/** Whether an event is an `$exception` holding that message and nothing else. */
export function isResizeObserverLoop(event: CapturedEvent): boolean {
	if (event.event !== "$exception") return false;
	const list = exceptionValues.safeParse(event.properties.$exception_list);
	return (
		list.success &&
		list.data.length > 0 &&
		list.data.every((e) => e.value === RESIZE_OBSERVER_LOOP)
	);
}
