import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { FlatList, Platform, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useWhoami } from "../../../src/api/queries";
import {
	useAuditEvents,
	useAuditRetention,
	usePeople,
} from "../../../src/api/workspace";
import { EmptyState, ErrorState } from "../../../src/ui/components";
import { LoadingIndicator } from "../../../src/ui/loading";
import { usePullToRefresh } from "../../../src/ui/screen";
import { SegmentedControl } from "../../../src/ui/segmented";
import { SettingsLink, SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import { EventRow } from "../../../src/workspace/audit/event-row";
import { FilterChoice } from "../../../src/workspace/audit/filter-choice";
import { HeaderButton } from "../../../src/workspace/audit/header-button";
import {
	type AuditCategory,
	KIND_OPTIONS,
	retentionLabel,
} from "../../../src/workspace/audit/labels";
import {
	ActionRow,
	ListSkeleton,
	PickerRow,
} from "../../../src/workspace/components";
import { formatDay } from "../../../src/workspace/format";

type CategoryChoice = AuditCategory | "all";

const CATEGORIES = [
	{ value: "all", label: "All" },
	{ value: "change", label: "Changes" },
	{ value: "security", label: "Security" },
] satisfies { value: CategoryChoice; label: string }[];

const ALL_KINDS = [{ value: "", label: "All kinds" }, ...KIND_OPTIONS];

/** The audit log: who changed what, and every sign-in. It pages with the
 *  list's end, so it is a `FlatList` and not the scroll view of `Screen`. */
export default function AuditLogScreen() {
	const router = useRouter();
	const palette = usePalette();
	const insets = useSafeAreaInsets();
	const whoami = useWhoami();
	const people = usePeople();
	const retention = useAuditRetention();
	const [category, setCategory] = useState<CategoryChoice>("all");
	const [userId, setUserId] = useState("");
	const [kind, setKind] = useState("");
	const [from, setFrom] = useState<string | null>(null);
	const [to, setTo] = useState<string | null>(null);
	const [open, setOpen] = useState<readonly string[]>([]);

	const kindFilter = KIND_OPTIONS.find(
		(option) => option.value === kind,
	)?.value;
	const events = useAuditEvents({
		category: category === "all" ? undefined : category,
		kind: kindFilter,
		userId: userId === "" ? undefined : userId,
		from: from ?? undefined,
		to: to ?? undefined,
	});
	const rows = events.data?.pages.flatMap((page) => page.events) ?? [];
	const pull = usePullToRefresh(
		events.isRefetching && !events.isFetchingNextPage,
		() => void events.refetch(),
	);
	const today = whoami.data?.today;
	const filtered =
		category !== "all" ||
		userId !== "" ||
		kind !== "" ||
		from !== null ||
		to !== null;

	const personOptions = [
		{ value: "", label: "Everyone" },
		...[...(people.data ?? [])]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((person) => ({ value: person.userId, label: person.name })),
	];

	const toggle = (id: string) =>
		setOpen((current) =>
			current.includes(id)
				? current.filter((value) => value !== id)
				: [...current, id],
		);
	const clear = () => {
		setCategory("all");
		setUserId("");
		setKind("");
		setFrom(null);
		setTo(null);
	};

	const header = (
		<View style={{ gap: SPACE.l, paddingBottom: SPACE.l }}>
			<View style={{ paddingHorizontal: SPACE.l }}>
				<SegmentedControl
					options={CATEGORIES}
					value={category}
					onChange={setCategory}
				/>
			</View>
			<FilterChoice
				title="Person"
				options={personOptions}
				value={userId}
				onChange={setUserId}
			/>
			<SettingsSection>
				<PickerRow
					title="From"
					mode="date"
					value={from}
					display={from ? formatDay(from) : undefined}
					onChange={setFrom}
					maximum={to ?? today}
				/>
				<PickerRow
					title="To"
					mode="date"
					value={to}
					display={to ? formatDay(to) : undefined}
					onChange={setTo}
					minimum={from ?? undefined}
					maximum={today}
				/>
				{filtered ? (
					<ActionRow label="Clear the filters" icon="refresh" onPress={clear} />
				) : null}
			</SettingsSection>
			<FilterChoice
				title="Kind"
				options={ALL_KINDS}
				value={kind}
				onChange={setKind}
			/>
			<SettingsSection
				footer={`Who changed what in this workspace, and every sign-in of its people. Older entries are deleted once a day.`}
			>
				<SettingsLink
					title="Retention"
					value={retention.data ? retentionLabel(retention.data.days) : ""}
					onPress={() => router.push("/workspace/audit-log/retention")}
				/>
			</SettingsSection>
		</View>
	);

	return (
		<>
			<Stack.Screen
				options={{
					title: "Audit log",
					headerRight: () => (
						<HeaderButton
							icon="share"
							label="Export the log"
							onPress={() =>
								router.push({
									pathname: "/workspace/audit-log/export",
									params: {
										category: category === "all" ? "" : category,
										kind,
										userId,
									},
								})
							}
						/>
					),
				}}
			/>
			<FlatList
				style={{ flex: 1, backgroundColor: palette.background }}
				data={rows}
				keyExtractor={(event) => event.id}
				extraData={open}
				contentInsetAdjustmentBehavior={
					Platform.OS === "ios" ? "automatic" : undefined
				}
				contentContainerStyle={{
					paddingTop: SPACE.s,
					paddingBottom: insets.bottom + SPACE.xxl,
				}}
				keyboardShouldPersistTaps="handled"
				ListHeaderComponent={header}
				ItemSeparatorComponent={() => <View style={{ height: SPACE.m }} />}
				renderItem={({ item }) => (
					<EventRow
						event={item}
						timeZone={whoami.data?.timezone}
						expanded={open.includes(item.id)}
						onToggle={() => toggle(item.id)}
					/>
				)}
				ListEmptyComponent={
					events.isPending ? (
						<ListSkeleton />
					) : events.error ? (
						<ErrorState
							error={events.error}
							onRetry={() => void events.refetch()}
						/>
					) : (
						<EmptyState icon="audit" title="Nothing recorded for this filter" />
					)
				}
				ListFooterComponent={
					events.isFetchingNextPage ? (
						<View style={{ paddingVertical: SPACE.l }}>
							<LoadingIndicator size={32} color={palette.primary} />
						</View>
					) : null
				}
				onEndReachedThreshold={0.5}
				onEndReached={() => {
					if (events.hasNextPage && !events.isFetchingNextPage) {
						void events.fetchNextPage();
					}
				}}
				refreshControl={
					<RefreshControl
						refreshing={pull.refreshing}
						onRefresh={pull.onRefresh}
						colors={[String(palette.primary)]}
						progressBackgroundColor={String(palette.surfaceContainerHigh)}
						tintColor={palette.primary}
					/>
				}
			/>
		</>
	);
}
