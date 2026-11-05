import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";

import {
	useOrganization,
	useUpdateOrganization,
} from "../../../src/api/workspace";
import { ErrorState } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SearchField } from "../../../src/ui/search-field";
import { SettingsChoice, SettingsSection } from "../../../src/ui/settings-list";
import { matchesSearch } from "../../../src/workspace/catalog/search";
import {
	ListSkeleton,
	NoteRow,
	notifyError,
} from "../../../src/workspace/components";
import {
	offsetOf,
	timezoneList,
} from "../../../src/workspace/organization/timezones";

/** A searchable list of the IANA timezones. A press saves the zone and
 *  goes back. */
export default function TimezoneScreen() {
	const router = useRouter();
	const settings = useOrganization();
	const update = useUpdateOrganization();
	const [query, setQuery] = useState("");
	const current = settings.data?.timezone ?? "";

	const items = useMemo(() => {
		const now = new Date();
		return timezoneList(current).map((zone) => ({
			zone,
			label: zone.replaceAll("_", " "),
			offset: offsetOf(zone, now),
		}));
	}, [current]);
	const shown = items.filter((item) =>
		matchesSearch(query, [item.label, item.offset]),
	);

	const pick = (zone: string) => {
		if (zone === current) {
			router.back();
			return;
		}
		update.mutate(
			{ timezone: zone },
			{
				onSuccess: () => router.back(),
				onError: (error) => notifyError("Could not save the timezone", error),
			},
		);
	};

	return (
		<>
			<Stack.Screen options={{ title: "Timezone" }} />
			<Screen topInset={false}>
				{settings.isPending ? (
					<ListSkeleton />
				) : settings.isError ? (
					<ErrorState
						error={settings.error}
						onRetry={() => void settings.refetch()}
					/>
				) : (
					<>
						<SearchField
							value={query}
							onChangeText={setQuery}
							placeholder="Search timezones"
						/>
						<SettingsSection>
							{shown.length === 0 ? (
								<NoteRow>No timezone matches.</NoteRow>
							) : (
								shown.map((item) => (
									<SettingsChoice
										key={item.zone}
										title={item.label}
										subtitle={item.offset || undefined}
										selected={item.zone === current}
										onPress={() => {
											if (!update.isPending) pick(item.zone);
										}}
									/>
								))
							)}
						</SettingsSection>
					</>
				)}
			</Screen>
		</>
	);
}
