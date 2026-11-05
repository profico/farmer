import { cn } from "#/lib/utils.ts";

/** The three facts that decide how the timer card looks. */
export type TimerView = {
	dropped: boolean;
	elsewhere: boolean;
	paused: boolean;
};

export type TimerStateLabel = "Dropped" | "Paused" | "Running";

export const timerStateLabel = ({
	dropped,
	paused,
}: Pick<TimerView, "dropped" | "paused">): TimerStateLabel =>
	dropped ? "Dropped" : paused ? "Paused" : "Running";

/** The text of the card's eyebrow. A timer in another workspace names it. */
export const timerStatusText = (
	state: TimerStateLabel,
	elsewhere: boolean,
	organizationName: string,
): string => (elsewhere ? `${state} in ${organizationName}` : state);

/** The eyebrow tint: warn when dropped, ok when it runs here. */
const eyebrowTone = ({ dropped, elsewhere, paused }: TimerView): string =>
	cn(dropped && "text-warn", !dropped && !elsewhere && !paused && "text-ok");

/** The tint of the figure: warn when dropped, quiet when held. */
const figureTone = ({ dropped, paused }: TimerView): string =>
	cn(dropped && "text-warn", !dropped && paused && "text-muted-foreground");

export const cardEyebrowClass = (view: TimerView): string =>
	cn("eyebrow truncate", eyebrowTone(view));

export const cardFigureClass = (view: TimerView): string =>
	cn("mono truncate text-xl tabular-nums", figureTone(view));

export const railTagClass = (view: TimerView): string =>
	cn("eyebrow", eyebrowTone(view));

export const railFigureClass = (view: TimerView): string =>
	cn("mono text-2xs tabular-nums", figureTone(view));

/** The short word on the rail. */
export const railTagText = ({
	dropped,
	paused,
}: Pick<TimerView, "dropped" | "paused">): string =>
	dropped ? "Drop" : paused ? "Held" : "Run";

/** The name of the rail button for a reader who cannot see it. */
export const railAriaLabel = (
	view: Pick<TimerView, "dropped" | "elsewhere">,
	state: TimerStateLabel,
	organizationName: string,
	figure: string,
	taskName: string,
): string =>
	view.dropped
		? "Your timer was dropped"
		: view.elsewhere
			? `A timer is ${state.toLowerCase()} in ${organizationName}`
			: `Stop the timer — ${figure} on ${taskName}`;

export type RailAction = "dismiss" | "stop" | "none";

/** What a press on the rail button does. */
export const railAction = ({
	dropped,
	elsewhere,
}: Pick<TimerView, "dropped" | "elsewhere">): RailAction =>
	dropped ? "dismiss" : elsewhere ? "none" : "stop";

/** The second line of the project block. */
export const taskLine = (
	taskName: string,
	entryDateLabel: string | null,
): string =>
	entryDateLabel ? `${taskName} · adds to ${entryDateLabel}` : taskName;
