import { requireOptionalNativeModule } from "expo";

/** What the ongoing notification shows. The figure is `elapsedSeconds` at
 *  `anchorMs` (the phone's clock, Unix milliseconds). */
export type TimerNotificationState = {
	/** "Project · Task". */
	title: string;
	/** The second line: the workspace name. */
	text: string;
	paused: boolean;
	elapsedSeconds: number;
	anchorMs: number;
	/** The slug that Pause and Resume call. */
	workspace: string;
	/** The deep link of Stop: the stop sheet. */
	stopUrl: string;
	/** The deep link of a tap on the notification. */
	openUrl: string;
};

type NativeTimerNotification = {
	canPost(): boolean;
	show(state: TimerNotificationState): void;
	hide(): void;
	/** False when the native side refuses the origin: plain http to a host that is
	 *  not local. */
	setCredential(origin: string, token: string, userAgent: string): boolean;
	clearCredential(): void;
};

/** The native module, or null where it does not exist: iOS, the web, and an
 *  Android build without the module (Expo Go). */
export const TimerNotification =
	requireOptionalNativeModule<NativeTimerNotification>("TimerNotification");
