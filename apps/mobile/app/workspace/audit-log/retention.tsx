import { Stack } from "expo-router";

import {
	useAuditRetention,
	useSetAuditRetention,
} from "../../../src/api/workspace";
import { ErrorState } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import {
	type AuditRetentionDays,
	RETENTION_OPTIONS,
	retentionLabel,
} from "../../../src/workspace/audit/labels";
import {
	ChoiceSection,
	confirmAction,
	ListSkeleton,
	notify,
	notifyError,
} from "../../../src/workspace/components";

/** How long the audit log keeps its entries. */
export default function AuditRetentionScreen() {
	const retention = useAuditRetention();
	const change = useSetAuditRetention();
	const days = retention.data?.days;
	// The list holds only the four values the server accepts. A value that
	// the server may add later shows as no choice.
	const current =
		RETENTION_OPTIONS.find((option) => option.value === days)?.value ?? null;

	const save = (next: AuditRetentionDays) =>
		change.mutate(
			{ days: next },
			{
				onSuccess: () => notify(`The log is kept for ${retentionLabel(next)}`),
				onError: (error) => notifyError("Could not save", error),
			},
		);
	const choose = (next: AuditRetentionDays) => {
		if (current !== null && next < current) {
			confirmAction({
				title: "Keep the log for a shorter time?",
				message: `Entries older than ${retentionLabel(next)} are deleted at the next sweep.`,
				action: "Shorten",
				onConfirm: () => save(next),
			});
			return;
		}
		save(next);
	};

	return (
		<Screen
			topInset={false}
			refreshing={retention.isRefetching}
			onRefresh={() => void retention.refetch()}
		>
			<Stack.Screen options={{ title: "Retention" }} />
			{retention.isPending ? (
				<ListSkeleton />
			) : retention.error ? (
				<ErrorState
					error={retention.error}
					onRetry={() => void retention.refetch()}
				/>
			) : (
				<ChoiceSection
					footer="Older entries are deleted once a day. A shorter period deletes the older entries at the next sweep."
					options={RETENTION_OPTIONS}
					value={current}
					disabled={change.isPending}
					onChange={choose}
				/>
			)}
		</Screen>
	);
}
