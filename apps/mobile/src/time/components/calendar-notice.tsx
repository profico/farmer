import type { TimeEntry } from "@farmer/api-client";
import { View } from "react-native";

import { useDismissCalendarChange, useTakeCalendarValues } from "../../api/day";
import { dayKeyInTimeZone } from "../../lib/days";
import { formatHours } from "../../lib/duration";
import { ActionButton, Card, ErrorBanner, Text } from "../../ui/components";
import { messageOf } from "../../ui/errors";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import {
	calendarChangeSentences,
	calendarDifference,
	clockTime,
	shortDay,
} from "../calendar-change";

/**
 * The meeting sync changed this entry, and the person did not answer yet.
 * "Got it" keeps the entry as it is. When the calendar now says another day
 * or length, the person may take the calendar's values instead, and the
 * entry follows the calendar again.
 */
export function CalendarNotice({
	entry,
	timezone,
	onTaken,
}: {
	entry: TimeEntry;
	timezone: string;
	/** The entry took the calendar's values. The form shows old values. */
	onTaken: () => void;
}) {
	const palette = usePalette();
	const dismiss = useDismissCalendarChange();
	const take = useTakeCalendarValues();
	const change = entry.calendarChange;
	if (!change) return null;
	const sentences = calendarChangeSentences(change);
	const calendar = calendarDifference(entry, change);
	const busy = dismiss.isPending || take.isPending;
	const failure = messageOf(dismiss.error ?? take.error);
	const changedAt = new Date(change.changedAt);
	return (
		<Card tone="secondary">
			<Text variant="titleSmall" color={palette.onSecondaryContainer}>
				Updated by your calendar
			</Text>
			{sentences.map((line) => (
				<Text
					key={line}
					variant="bodyMedium"
					color={palette.onSecondaryContainer}
				>
					{line}
				</Text>
			))}
			{calendar ? (
				<Text variant="bodyMedium" color={palette.onSecondaryContainer}>
					Your calendar now says {shortDay(calendar.date)},{" "}
					{formatHours(calendar.durationSeconds)}. Your entry keeps your values.
					Take the calendar's values and it follows the calendar again.
				</Text>
			) : null}
			<Text variant="bodySmall" color={palette.onSecondaryContainer}>
				{shortDay(dayKeyInTimeZone(changedAt, timezone))} at{" "}
				{clockTime(change.changedAt, timezone)}
			</Text>
			{failure ? <ErrorBanner message={failure} /> : null}
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.s }}>
				<ActionButton
					label="Got it"
					variant="outlined"
					onPress={() => dismiss.mutate(entry.id)}
					disabled={busy}
				/>
				{calendar ? (
					<ActionButton
						label="Use the calendar's values"
						variant="text"
						onPress={() => take.mutate(entry.id, { onSuccess: onTaken })}
						disabled={busy}
					/>
				) : null}
			</View>
		</Card>
	);
}
