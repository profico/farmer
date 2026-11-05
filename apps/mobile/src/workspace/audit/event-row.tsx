import type { AuditEvent } from "@farmer/api-client";
import { View } from "react-native";

import { Text } from "../../ui/components";
import { Icon } from "../../ui/icon";
import { SettingsSection } from "../../ui/settings-list";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import { Badge, CustomRow } from "../components";
import { formatInstant } from "../format";
import { detailText, fieldLabel, formatValue, viaLabel } from "./labels";

/** One event of the log. A press opens the changes and the details. */
export function EventRow({
	event,
	timeZone,
	expanded,
	onToggle,
}: {
	event: AuditEvent;
	timeZone: string | undefined;
	expanded: boolean;
	onToggle: () => void;
}) {
	const palette = usePalette();
	const actor = event.actorName ?? "Someone";
	const security = event.category === "security";
	const lines = [
		formatInstant(event.occurredAt, timeZone),
		`Via ${viaLabel(event.via)}`,
	];
	return (
		<SettingsSection>
			<CustomRow
				onPress={onToggle}
				accessibilityLabel={`${actor} ${event.summary}, ${lines.join(", ")}, ${expanded ? "hide" : "show"} details`}
			>
				<View style={{ flex: 1, gap: SPACE.xs }}>
					<Text variant="bodyLarge">{`${actor} ${event.summary}`}</Text>
					{event.impersonatorName ? (
						<Text variant="bodySmall" color={palette.onSurfaceVariant}>
							{`Impersonated by ${event.impersonatorName}`}
						</Text>
					) : null}
					<Text variant="bodySmall" color={palette.onSurfaceVariant}>
						{lines.join("\n")}
					</Text>
					{expanded ? <EventDetails event={event} /> : null}
				</View>
				<Badge
					label={security ? "Security" : "Change"}
					tone={security ? "accent" : "neutral"}
				/>
			</CustomRow>
		</SettingsSection>
	);
}

function EventDetails({ event }: { event: AuditEvent }) {
	const palette = usePalette();
	const changed = Object.entries(event.changes ?? {});
	const extra = Object.entries(event.details ?? {});
	return (
		<View style={{ gap: SPACE.s, paddingTop: SPACE.s }}>
			{changed.map(([field, change]) => (
				<View key={field} style={{ gap: 2 }}>
					<Text variant="labelMedium" color={palette.onSurfaceVariant}>
						{fieldLabel(field)}
					</Text>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							flexWrap: "wrap",
							gap: SPACE.xs,
						}}
					>
						<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
							{formatValue(change.from)}
						</Text>
						<Icon name="forward" size={14} color={palette.onSurfaceVariant} />
						<Text variant="bodyMedium">{formatValue(change.to)}</Text>
					</View>
				</View>
			))}
			{extra.map(([key, value]) => (
				<Line key={key} label={fieldLabel(key)} value={detailText(value)} />
			))}
			{event.ip ? <Line label="IP address" value={event.ip} /> : null}
			{event.userAgent ? (
				<Line label="Browser" value={event.userAgent} />
			) : null}
			<Line label="Event" value={event.kind} />
		</View>
	);
}

function Line({ label, value }: { label: string; value: string }) {
	const palette = usePalette();
	return (
		<View style={{ gap: 2 }}>
			<Text variant="labelMedium" color={palette.onSurfaceVariant}>
				{label}
			</Text>
			<Text variant="bodyMedium">{value}</Text>
		</View>
	);
}
