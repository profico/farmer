import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import { useWhoami } from "../../../src/api/queries";
import { useHourFund, usePrefillHourFund } from "../../../src/api/workspace";
import {
	EmptyState,
	ErrorState,
	IconButton,
	Text,
} from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	ActionRow,
	confirmAction,
	DetailRow,
	ListSkeleton,
	notify,
	notifyError,
} from "../../../src/workspace/components";
import { hoursOf } from "../../../src/workspace/format";

const MONTHS = Array.from({ length: 12 }, (_, index) =>
	new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
		new Date(Date.UTC(2000, index, 15)),
	),
);

/** The monthly hour fund of one year. A press on a month opens its sheet.
 *  Admins only, as on the web. */
export default function HourFundScreen() {
	const access = useAccess();
	if (access.ready && !access.isAdmin) {
		return (
			<>
				<Stack.Screen options={{ title: "Hour fund" }} />
				<Screen topInset={false}>
					<EmptyState
						icon="fund"
						title="Admins only"
						message="Only an admin can manage the hour fund."
					/>
				</Screen>
			</>
		);
	}
	return <HourFundYear />;
}

function HourFundYear() {
	const router = useRouter();
	const palette = usePalette();
	const whoami = useWhoami();
	const thisYear = Number.parseInt((whoami.data?.today ?? "").slice(0, 4), 10);
	const [chosen, setChosen] = useState<number | null>(null);
	const year =
		chosen ?? (Number.isFinite(thisYear) ? thisYear : new Date().getFullYear());
	const fund = useHourFund(year);
	const prefill = usePrefillHourFund();
	const byMonth = new Map(
		(fund.data ?? []).map((month) => [month.month, month.fundSeconds]),
	);

	const askPrefill = () => {
		const before = byMonth.size;
		confirmAction({
			title: `Prefill ${year}?`,
			message:
				"Each month with no fund gets the Mon-Fri days that are not public holidays, at 8 hours each. A month that has a fund keeps it. The legal fund sometimes differs, so check the numbers.",
			action: "Prefill",
			onConfirm: () =>
				prefill.mutate(
					{ year },
					{
						onSuccess: (months) => {
							const filled = months.length - before;
							notify(
								filled <= 0
									? "Every month already has a fund"
									: `Filled ${filled} ${filled === 1 ? "month" : "months"}`,
							);
						},
						onError: (error) =>
							notifyError("Could not prefill the year", error),
					},
				),
		});
	};

	return (
		<>
			<Stack.Screen options={{ title: "Hour fund" }} />
			<Screen
				topInset={false}
				refreshing={fund.isRefetching}
				onRefresh={() => void fund.refetch()}
			>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "center",
						gap: SPACE.l,
					}}
				>
					<IconButton
						icon="back"
						label="Previous year"
						onPress={() => setChosen(year - 1)}
					/>
					<Text variant="titleLarge">{String(year)}</Text>
					<IconButton
						icon="forward"
						label="Next year"
						onPress={() => setChosen(year + 1)}
					/>
				</View>
				{fund.isPending ? (
					<ListSkeleton rows={12} />
				) : fund.isError ? (
					<ErrorState error={fund.error} onRetry={() => void fund.refetch()} />
				) : (
					<>
						<SettingsSection footer="The official number of working hours in each month. It is the denominator of everyone's expected hours, so a month left blank shows no expected figure.">
							{MONTHS.map((label, index) => {
								const seconds = byMonth.get(index + 1);
								const value =
									seconds === undefined ? "Not set" : `${hoursOf(seconds)} h`;
								return (
									<DetailRow
										key={label}
										title={label}
										subtitle={
											seconds === undefined
												? undefined
												: `${hoursOf(seconds / 8)} working days`
										}
										trailing={
											<Text
												variant="bodyLarge"
												color={
													seconds === undefined
														? palette.onSurfaceVariant
														: palette.onSurface
												}
											>
												{value}
											</Text>
										}
										accessibilityLabel={`${label} ${year}, ${value}`}
										onPress={() =>
											router.push({
												pathname: "/workspace/hour-fund/month",
												params: {
													year: String(year),
													month: String(index + 1),
												},
											})
										}
									/>
								);
							})}
						</SettingsSection>
						<SettingsSection footer="Prefilling counts Mon-Fri days that are not public holidays and multiplies by 8. A month that has a fund keeps it.">
							<ActionRow
								label="Prefill the year"
								icon="refresh"
								busy={prefill.isPending}
								onPress={askPrefill}
							/>
						</SettingsSection>
					</>
				)}
			</Screen>
		</>
	);
}
