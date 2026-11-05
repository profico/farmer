import type { CalendarEvent } from "@farmer/api-client";
import { View } from "react-native";

import { useCalendarEvents } from "../../api/day";
import { ListRow, Skeleton, Text } from "../../ui/components";
import { Icon } from "../../ui/icon";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { clockTime } from "../calendar-change";

/**
 * The timed meetings of a day in the person's Google Calendar. A pick
 * gives the entry the meeting's length, its title when the note is empty,
 * and its link.
 */
export function MeetingPicker({
	date,
	timezone,
	selectedId,
	onPick,
}: {
	date: string;
	timezone: string;
	selectedId: string | null;
	onPick: (event: CalendarEvent) => void;
}) {
	const palette = usePalette();
	const events = useCalendarEvents(date, true);
	return (
		<View
			style={{
				borderRadius: 16,
				overflow: "hidden",
				backgroundColor: palette.surfaceContainer,
			}}
		>
			<View style={{ paddingHorizontal: SPACE.l, paddingVertical: SPACE.s }}>
				<Text variant="labelMedium" color={palette.onSurfaceVariant}>
					Google Calendar
				</Text>
			</View>
			{events.isPending ? (
				<View style={{ padding: SPACE.l }}>
					<Skeleton height={40} />
				</View>
			) : events.isError ? (
				<Message tone="error">
					Could not load your calendar. Try reconnecting Google.
				</Message>
			) : events.data.length === 0 ? (
				<Message>No meetings found for this day.</Message>
			) : (
				events.data.map((event) => {
					const when = `${clockTime(event.start, timezone)} to ${clockTime(event.end, timezone)}`;
					return (
						<View
							key={event.id}
							style={{
								borderTopWidth: 1,
								borderTopColor: palette.outlineVariant,
							}}
						>
							<ListRow
								title={event.title}
								subtitle={event.meetingUrl ? `${when}, has a link` : when}
								selected={event.id === selectedId}
								onPress={() => onPick(event)}
								trailing={
									event.id === selectedId ? (
										<Icon name="check" size={20} color={palette.primary} />
									) : event.meetingUrl ? (
										<Icon
											name="meeting"
											size={20}
											color={palette.onSurfaceVariant}
										/>
									) : undefined
								}
							/>
						</View>
					);
				})
			)}
		</View>
	);
}

function Message({ children, tone }: { children: string; tone?: "error" }) {
	const palette = usePalette();
	return (
		<View
			style={{
				paddingHorizontal: SPACE.l,
				paddingVertical: SPACE.m,
				borderTopWidth: 1,
				borderTopColor: palette.outlineVariant,
			}}
		>
			<Text
				variant="bodyMedium"
				color={tone === "error" ? palette.error : palette.onSurfaceVariant}
			>
				{children}
			</Text>
		</View>
	);
}
