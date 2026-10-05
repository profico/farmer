import { SettingsSection } from "../../ui/settings-list";
import { SettingsChoice } from "../../ui/settings-list";
import { toggleEvent, WEBHOOK_EVENTS, type WebhookEventKind } from "./events";

/** The event kinds as rows with a check on each chosen kind. At least one
 *  must stay chosen: the server refuses an empty list. */
export function EventPicker({
	chosen,
	onChange,
	disabled,
}: {
	chosen: readonly WebhookEventKind[];
	onChange: (chosen: WebhookEventKind[]) => void;
	disabled?: boolean;
}) {
	return (
		<SettingsSection footer="Farmer sends these events to the endpoint. Pick at least one.">
			{WEBHOOK_EVENTS.map((event) => (
				<SettingsChoice
					key={event.value}
					title={event.value}
					subtitle={event.description}
					selected={chosen.includes(event.value)}
					onPress={() => {
						if (disabled) return;
						onChange(toggleEvent(chosen, event.value));
					}}
				/>
			))}
		</SettingsSection>
	);
}
