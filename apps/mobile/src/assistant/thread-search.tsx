import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Platform, View } from "react-native";

import { useSearchThreads } from "../api/assistant";
import { EmptyState, ErrorState, ListRow, Skeleton } from "../ui/components";
import { SearchField } from "../ui/search-field";
import { SPACE } from "../ui/type";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

/** The text in the search box, and the query it settles on. */
export const useThreadSearch = () => {
	const [text, setText] = useState("");
	const [query, setQuery] = useState("");
	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim()), DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [text]);
	return {
		text,
		setText,
		// A cleared box shows the list at once.
		query: text.trim() === "" ? "" : query,
		active: text.trim() !== "",
	};
};

export type ThreadSearch = ReturnType<typeof useThreadSearch>;

/**
 * The search box of the thread list. iOS uses the search bar of the system
 * header. Android draws the Material search bar above the list.
 */
export function ThreadSearchBox({ search }: { search: ThreadSearch }) {
	if (Platform.OS === "ios") {
		return (
			<Stack.Screen
				options={{
					headerSearchBarOptions: {
						placeholder: "Search chats",
						autoCapitalize: "none",
						onChangeText: (event) => search.setText(event.nativeEvent.text),
						onCancelButtonPress: () => search.setText(""),
					},
				}}
			/>
		);
	}
	return (
		<View style={{ paddingVertical: SPACE.s }}>
			<SearchField
				value={search.text}
				onChangeText={search.setText}
				placeholder="Search chats"
			/>
		</View>
	);
}

/** The threads that match, in place of the list. */
export function ThreadSearchResults({ query }: { query: string }) {
	const router = useRouter();
	const hits = useSearchThreads(query);
	if (query.length < MIN_CHARS) {
		return (
			<EmptyState
				icon="search"
				title="Keep typing"
				message={`Type at least ${MIN_CHARS} characters.`}
			/>
		);
	}
	if (hits.isPending) {
		return (
			<View style={{ padding: SPACE.l, gap: SPACE.m }}>
				<Skeleton height={56} />
				<Skeleton height={56} />
			</View>
		);
	}
	if (hits.error) {
		return (
			<ErrorState error={hits.error} onRetry={() => void hits.refetch()} />
		);
	}
	return (
		<FlatList
			data={hits.data}
			keyExtractor={(hit) => hit.id}
			keyboardShouldPersistTaps="handled"
			contentInsetAdjustmentBehavior="automatic"
			ListEmptyComponent={
				<EmptyState
					icon="search"
					title="No chat matches"
					message="Try other words."
				/>
			}
			renderItem={({ item }) => (
				<ListRow
					icon="assistant"
					title={item.title}
					subtitle={item.snippet ?? undefined}
					onPress={() =>
						router.push({
							pathname: "/assistant/[id]",
							params: { id: item.id },
						})
					}
				/>
			)}
		/>
	);
}
