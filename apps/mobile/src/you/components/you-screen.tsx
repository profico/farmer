import { Stack } from "expo-router";
import type { ReactNode } from "react";

import { ErrorState, IconButton, Skeleton } from "../../ui/components";
import type { IconName } from "../../ui/icons";
import { Inset, Screen } from "../../ui/screen";

/**
 * A screen of the "You" stack: the title in the navigation header, an
 * optional button at the end of the header, and a scrolling body that a
 * pull reads again.
 */
export function YouScreen({
	title,
	action,
	refreshing,
	onRefresh,
	children,
}: {
	title: string;
	/** One button at the end of the header, such as "Add". */
	action?: { icon: IconName; label: string; onPress: () => void };
	refreshing?: boolean;
	onRefresh?: () => void;
	children: ReactNode;
}) {
	return (
		<>
			<Stack.Screen
				options={{
					title,
					headerRight: action
						? () => (
								<IconButton
									icon={action.icon}
									label={action.label}
									onPress={action.onPress}
								/>
							)
						: undefined,
				}}
			/>
			<Screen topInset={false} refreshing={refreshing} onRefresh={onRefresh}>
				{children}
			</Screen>
		</>
	);
}

/** The rows of a list while its first read runs. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
	return (
		<Inset>
			{Array.from({ length: rows }, (_, i) => (
				<Skeleton key={i} height={56} />
			))}
		</Inset>
	);
}

/** A screen whose first read failed, with a way to try again. */
export function YouError({
	title,
	error,
	onRetry,
}: {
	title: string;
	error: Error;
	onRetry: () => void;
}) {
	return (
		<YouScreen title={title}>
			<ErrorState error={error} onRetry={onRetry} />
		</YouScreen>
	);
}
