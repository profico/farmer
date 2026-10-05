import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import {
	useClearHourFund,
	useHourFund,
	useHourFundSuggestion,
	useSetHourFund,
} from "../../../src/api/workspace";
import { FormSection, Sheet } from "../../../src/forms/sheet";
import {
	EmptyState,
	ErrorBanner,
	Field,
	Skeleton,
	Text,
} from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { SettingsSection } from "../../../src/ui/settings-list";
import { usePalette } from "../../../src/ui/theme";
import { SPACE } from "../../../src/ui/type";
import {
	ActionRow,
	confirmDestructive,
	notifyError,
} from "../../../src/workspace/components";
import { hoursOf } from "../../../src/workspace/format";
import { intParamOf } from "../../../src/workspace/params";

const SECONDS_PER_HOUR = 3600;

const monthName = (year: number, month: number) =>
	new Intl.DateTimeFormat("en-US", {
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(Date.UTC(year, month - 1, 15)));

/** The decimal hours of a text, or null when it is not a number of zero or
 *  more. A comma counts as the decimal mark. */
const parseHours = (text: string) => {
	const trimmed = text.trim().replace(",", ".");
	if (trimmed === "") return null;
	const hours = Number(trimmed);
	return Number.isFinite(hours) && hours >= 0 ? hours : null;
};

/** The fund of one month (params `year` and `month`): the hours, the
 *  suggestion from the holiday calendar, Clear and Save. */
export default function HourFundMonthSheet() {
	const params = useLocalSearchParams<{ year?: string; month?: string }>();
	const year = intParamOf(params.year, new Date().getFullYear());
	const month = Math.min(12, Math.max(1, intParamOf(params.month, 1)));
	const access = useAccess();
	const fund = useHourFund(year);
	const title = monthName(year, month);

	if (access.ready && !access.isAdmin) {
		return (
			<Sheet
				title={title}
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<EmptyState
					icon="fund"
					title="Admins only"
					message="Only an admin can manage the hour fund."
				/>
			</Sheet>
		);
	}
	if (fund.isPending) {
		return (
			<Sheet title={title} actionLabel="Save" onAction={() => undefined} busy>
				<Skeleton height={56} radius={16} />
			</Sheet>
		);
	}
	if (fund.isError) {
		return (
			<Sheet
				title={title}
				actionLabel="Save"
				onAction={() => undefined}
				actionDisabled
			>
				<ErrorBanner message={fund.error.message} />
			</Sheet>
		);
	}
	const current = fund.data.find((row) => row.month === month);
	return (
		<MonthForm
			year={year}
			month={month}
			title={title}
			fundSeconds={current?.fundSeconds ?? null}
		/>
	);
}

function MonthForm({
	year,
	month,
	title,
	fundSeconds,
}: {
	year: number;
	month: number;
	title: string;
	fundSeconds: number | null;
}) {
	const router = useRouter();
	const palette = usePalette();
	const suggestion = useHourFundSuggestion(year, month);
	const set = useSetHourFund();
	const clear = useClearHourFund();
	const [text, setText] = useState(
		fundSeconds === null ? "" : hoursOf(fundSeconds),
	);
	const hours = parseHours(text);
	const busy = set.isPending || clear.isPending;
	const failure = messageOf(set.error ?? clear.error);

	const save = () => {
		if (hours === null) return;
		set.mutate(
			{ year, month, fundSeconds: Math.round(hours * SECONDS_PER_HOUR) },
			{ onSuccess: () => router.back() },
		);
	};

	const doClear = () =>
		clear.mutate(
			{ year, month },
			{
				onSuccess: () => router.back(),
				onError: (error) => notifyError("Could not clear the month", error),
			},
		);

	return (
		<Sheet
			title={title}
			actionLabel="Save"
			onAction={save}
			busy={busy}
			actionDisabled={hours === null}
		>
			{failure ? <ErrorBanner message={failure} /> : null}
			<FormSection label="Hour fund">
				<Field
					label="Hours"
					value={text}
					onChangeText={setText}
					inputMode="decimal"
					keyboardType="decimal-pad"
					placeholder="Not set"
					returnKeyType="done"
					onSubmitEditing={save}
					error={
						text.trim() !== "" && hours === null
							? "Enter a number of hours, such as 168."
							: null
					}
					hint="The official number of working hours in this month."
				/>
			</FormSection>
			<FormSection label="Suggestion">
				{suggestion.isPending ? (
					<Skeleton height={24} radius={8} />
				) : suggestion.isError ? (
					<Text variant="bodyMedium" color={palette.onSurfaceVariant}>
						{suggestion.error.message}
					</Text>
				) : (
					<View style={{ gap: SPACE.s }}>
						<Text variant="bodyLarge">
							{`${suggestion.data.workingDays} working days, ${hoursOf(suggestion.data.fundSeconds)} hours`}
						</Text>
						<Text variant="bodySmall" color={palette.onSurfaceVariant}>
							Mon-Fri days that are not public holidays, at 8 hours each. The
							legal fund sometimes differs, so check the number.
						</Text>
					</View>
				)}
			</FormSection>
			{suggestion.data ? (
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection>
						<ActionRow
							label="Use the suggestion"
							onPress={() => setText(hoursOf(suggestion.data.fundSeconds))}
						/>
					</SettingsSection>
				</View>
			) : null}
			{fundSeconds !== null ? (
				<View style={{ marginHorizontal: -SPACE.l }}>
					<SettingsSection footer="A cleared month has no fund again. That is not the same as a fund of zero.">
						<ActionRow
							label="Clear"
							destructive
							busy={clear.isPending}
							onPress={() =>
								confirmDestructive({
									title: `Clear ${title}?`,
									message:
										"The month has no fund then, so no expected hours can be computed for it.",
									action: "Clear",
									onConfirm: doClear,
								})
							}
						/>
					</SettingsSection>
				</View>
			) : null}
		</Sheet>
	);
}
