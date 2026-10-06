import { requireOptionalNativeModule } from "expo";

type Subscription = { remove(): void };

/**
 * The timer's Live Activity on iOS (ADR 0005). The Swift side is in
 * `ios/FarmerLiveActivityModule.swift`, and the widget that draws it is in
 * `plugins/ios-targets/timer-widget`.
 *
 * BUILT ON A MAC, NOT RUN ON A DEVICE: the iOS app built on a Mac on
 * 6 Oct 2026. Run this module and the widget on a device before a release.
 */

/** The content state, as the Server sends it (`docs/domains/mobile.md`).
 *  `runningSinceMs` is Unix milliseconds, never a Swift `Date`. */
export type LiveActivityContentState = {
	state: "running" | "held";
	runningSinceMs: number | null;
	accumulatedSeconds: number;
	workspace: string;
};

/** The labels of an activity that the app starts. A push-to-start has only
 *  `{ version: 1 }`, so every label is optional on the Swift side. */
export type LiveActivityLabels = {
	workspaceName: string;
	project: string | null;
	task: string;
};

type NativeLiveActivity = {
	areActivitiesEnabled(): boolean;
	/** Start an activity, or update the one that exists with the same
	 *  labels. Ends every other activity. Returns the activity id. */
	show(
		labels: LiveActivityLabels,
		state: LiveActivityContentState,
	): string | null;
	/** End every activity of the timer, at once. */
	endAll(): void;
	pushToStartToken(): string | null;
	addListener(
		event: "onActivityPushToken",
		listener: (event: { activityId: string; token: string }) => void,
	): Subscription;
	/** An activity ended. `remaining` counts the activities that are still
	 *  active, so zero means that no activity holds a token now. */
	addListener(
		event: "onActivityEnded",
		listener: (event: { activityId: string; remaining: number }) => void,
	): Subscription;
	addListener(
		event: "onPushToStartToken",
		listener: (event: { token: string }) => void,
	): Subscription;
};

/** The native module, or null outside an iOS build that has it. */
export const LiveActivity =
	requireOptionalNativeModule<NativeLiveActivity>("FarmerLiveActivity");
