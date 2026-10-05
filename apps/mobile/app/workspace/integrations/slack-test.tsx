import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useWhoami } from "../../../src/api/queries";
import { usePeople, useSendSlackTest } from "../../../src/api/workspace";
import { FormSection, Sheet } from "../../../src/forms/sheet";
import { EmptyState, ErrorBanner, Skeleton } from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { SettingsChoice, SettingsSection } from "../../../src/ui/settings-list";
import { SearchField, notify } from "../../../src/workspace/components";

const NOT_SENT =
	"Couldn't send. Check that Slack is connected and that this person is in the workspace.";

/** A sheet: pick a person and send them a Slack test message. The message
 *  goes through the same path as the reminders, so one that arrives proves
 *  that the reminders arrive too. */
export default function SlackTestSheet() {
	const router = useRouter();
	const whoami = useWhoami();
	const people = usePeople();
	const send = useSendSlackTest();
	const [picked, setPicked] = useState<string | null>(null);
	const [query, setQuery] = useState("");

	const userId = picked ?? whoami.data?.userId ?? null;
	const needle = query.trim().toLowerCase();
	const active = (people.data ?? []).filter(
		(person) =>
			person.archivedAt === null &&
			(needle === "" ||
				person.name.toLowerCase().includes(needle) ||
				person.email.toLowerCase().includes(needle)),
	);
	const [failure, setFailure] = useState<string | null>(null);
	const error = failure ?? (send.error ? messageOf(send.error) : null);

	const submit = () => {
		if (!userId) return;
		setFailure(null);
		send.mutate(
			{ userId },
			{
				onSuccess: ({ sent }) => {
					if (!sent) {
						setFailure(NOT_SENT);
						return;
					}
					notify(
						userId === whoami.data?.userId
							? "Sent. Check your Slack messages."
							: "Test message sent",
					);
					router.back();
				},
			},
		);
	};

	return (
		<Sheet
			title="Test message"
			actionLabel="Send"
			onAction={submit}
			busy={send.isPending}
			actionDisabled={userId === null}
		>
			{error ? <ErrorBanner message={error} /> : null}
			<FormSection label="Send to">
				<SearchField
					value={query}
					onChangeText={setQuery}
					placeholder="Search people"
				/>
				{people.isPending ? (
					<View style={{ gap: 8 }}>
						<Skeleton height={56} radius={16} />
						<Skeleton height={56} radius={16} />
					</View>
				) : people.error ? (
					<ErrorBanner message={people.error.message} />
				) : active.length === 0 ? (
					<EmptyState icon="people" title="Nobody found" />
				) : (
					<SettingsSection footer="The message goes through the same path as the reminders. If it arrives, they will too.">
						{active.map((person) => (
							<SettingsChoice
								key={person.userId}
								title={person.name}
								subtitle={person.email}
								selected={person.userId === userId}
								onPress={() => setPicked(person.userId)}
							/>
						))}
					</SettingsSection>
				)}
			</FormSection>
		</Sheet>
	);
}
