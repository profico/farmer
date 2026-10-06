import { ApiClientError, type Timer } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { useLayoutEffect, useRef, useState } from "react";
import { Alert, Animated, View } from "react-native";

import { useTimer, useTimerAction } from "../api/queries";
import { formatHours, formatStopwatch } from "../lib/duration";
import { useSession } from "../session/session";
import {
	ActionButton,
	Card,
	ErrorBanner,
	IconButton,
	Skeleton,
	Text,
} from "../ui/components";
import { messageOf } from "../ui/errors";
import { Icon } from "../ui/icon";
import { EASE_OUT, MOTION_MS } from "../ui/motion";
import { usePalette } from "../ui/theme";
import { SPACE } from "../ui/type";
import { removed, toggled } from "./haptics";
import { useElapsed } from "./use-elapsed";

const whatItMeasures = (timer: Timer) =>
	[timer.project?.name ?? "No project", timer.task.name].join(" · ");

/**
 * The stopwatch (ADR 0003). One timer per person, across workspaces: a
 * timer that runs in another workspace is named, not hidden. Stop holds the
 * clock and opens the confirm sheet; nothing is logged before Save there.
 */
function TimerCardBody() {
	const palette = usePalette();
	const router = useRouter();
	const { setWorkspace } = useSession();
	const query = useTimer();
	const action = useTimerAction();
	const timer = query.data?.timer ?? null;
	const elapsed = useElapsed(timer, query.dataUpdatedAt);

	if (query.isPending) return <Skeleton height={132} radius={16} />;
	if (query.isError) {
		// A server from before the stopwatch has no timer route. The rest of
		// the screen still works, so this card steps aside.
		if (
			query.error instanceof ApiClientError &&
			query.error.kind === "unsupported"
		) {
			return null;
		}
		return <ErrorBanner message={query.error.message} />;
	}

	const failure = messageOf(action.error);

	if (!timer) {
		return (
			<Card>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: SPACE.m }}
				>
					<Icon name="timer" color={palette.onSurfaceVariant} />
					<View style={{ flex: 1 }}>
						<Text variant="titleMedium">No timer is running</Text>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							Measure the work as it happens. Nothing is logged until you stop
							it.
						</Text>
					</View>
				</View>
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label="Start timer"
						onPress={() => router.push("/start-timer")}
					/>
				</View>
			</Card>
		);
	}

	if (timer.droppedAt) {
		return (
			<Card tone="error">
				<Text variant="titleMedium" color={palette.onErrorContainer}>
					Your timer was dropped
				</Text>
				<Text variant="bodyMedium" color={palette.onErrorContainer}>
					It ran past your limit, so it logged nothing. Log the time by hand,
					then clear this notice.
				</Text>
				{failure ? <ErrorBanner message={failure} /> : null}
				<View style={{ flexDirection: "row", gap: SPACE.s }}>
					<ActionButton
						label="Clear"
						onPress={() => action.mutate("discard")}
						disabled={action.isPending}
					/>
				</View>
			</Card>
		);
	}

	if (!timer.organization.here) {
		return (
			<Card tone="primary">
				<Text variant="titleMedium" color={palette.onPrimaryContainer}>
					A timer is running in {timer.organization.name}
				</Text>
				<Text variant="bodyMedium" color={palette.onPrimaryContainer}>
					{formatStopwatch(elapsed)} on {whatItMeasures(timer)}. You have one
					timer for all your workspaces.
				</Text>
				<View style={{ flexDirection: "row" }}>
					<ActionButton
						label={`Go to ${timer.organization.name}`}
						variant="outlined"
						onPress={() => void setWorkspace(timer.organization.slug)}
					/>
				</View>
			</Card>
		);
	}

	const stop = async () => {
		// Stop holds the clock first, so the figure in the sheet stands still
		// and closing the sheet leaves a held timer, as on the web.
		if (!timer.paused) await action.mutateAsync("pause");
		router.push("/stop-timer");
	};

	const discard = () =>
		Alert.alert(
			"Discard the timer?",
			timer.entry
				? "The time measured since you started is thrown away. The entry keeps what it held."
				: "The time it measured is thrown away and nothing is logged.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Discard",
					style: "destructive",
					onPress: () => action.mutate("discard", { onSuccess: removed }),
				},
			],
		);

	// A paused timer has its own colour and a pause icon, so it does not
	// look like one that runs. The API calls the state "held"; the button
	// and the label say "Pause", as the web app does.
	const ink = timer.paused
		? palette.onSecondaryContainer
		: palette.onPrimaryContainer;

	return (
		<Card tone={timer.paused ? "secondary" : "primary"}>
			<View style={{ flexDirection: "row", alignItems: "center" }}>
				<View style={{ flex: 1 }}>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							gap: SPACE.xs,
						}}
					>
						<Icon
							name={timer.paused ? "pause" : "timer"}
							size={16}
							color={ink}
						/>
						<Text variant="labelLarge" color={ink}>
							{timer.paused ? "Paused" : "Running"}
						</Text>
					</View>
					<Text variant="displaySmall" color={ink} numberOfLines={1}>
						{formatStopwatch(elapsed)}
					</Text>
				</View>
				<IconButton
					icon="delete"
					label="Discard the timer"
					onPress={discard}
					disabled={action.isPending}
				/>
			</View>
			<Text variant="bodyMedium" color={ink} numberOfLines={2}>
				{whatItMeasures(timer)}
				{timer.description ? `: ${timer.description}` : ""}
			</Text>
			{timer.entry ? (
				<Text variant="bodySmall" color={ink}>
					Adds to an entry that held {formatHours(timer.entry.durationSeconds)}.
				</Text>
			) : null}
			{failure ? <ErrorBanner message={failure} /> : null}
			<View style={{ flexDirection: "row", gap: SPACE.s }}>
				{timer.paused ? (
					<ActionButton
						label="Resume"
						variant="outlined"
						onPress={() => action.mutate("resume", { onSuccess: toggled })}
						disabled={action.isPending}
					/>
				) : (
					<ActionButton
						label="Pause"
						variant="outlined"
						onPress={() => action.mutate("pause", { onSuccess: toggled })}
						disabled={action.isPending}
					/>
				)}
				<ActionButton
					label="Stop"
					onPress={() => void stop().catch(() => undefined)}
					disabled={action.isPending}
				/>
			</View>
		</Card>
	);
}

/** The one word for what the card shows. A change of it fades in the new
 *  content; the tick of the stopwatch does not. */
const lookOf = (
	pending: boolean,
	failed: boolean,
	timer: Timer | null,
): "loading" | "error" | "none" | "dropped" | "away" | "paused" | "running" => {
	if (pending) return "loading";
	if (failed) return "error";
	if (!timer) return "none";
	if (timer.droppedAt) return "dropped";
	if (!timer.organization.here) return "away";
	return timer.paused ? "paused" : "running";
};

export function TimerCard() {
	const query = useTimer();
	const look = lookOf(
		query.isPending,
		query.isError,
		query.data?.timer ?? null,
	);
	const [opacity] = useState(() => new Animated.Value(1));
	const first = useRef(true);

	// Before the paint, so the new content never shows at full strength for
	// one frame before it fades.
	useLayoutEffect(() => {
		if (first.current) {
			first.current = false;
			return;
		}
		opacity.setValue(0.4);
		const animation = Animated.timing(opacity, {
			toValue: 1,
			duration: MOTION_MS.small,
			easing: EASE_OUT,
			useNativeDriver: true,
		});
		animation.start();
		return () => animation.stop();
	}, [look, opacity]);

	// A server without the stopwatch shows no card, and no empty view takes
	// a gap in the column.
	if (
		query.error instanceof ApiClientError &&
		query.error.kind === "unsupported"
	) {
		return null;
	}
	return (
		<Animated.View style={{ opacity }}>
			<TimerCardBody />
		</Animated.View>
	);
}
