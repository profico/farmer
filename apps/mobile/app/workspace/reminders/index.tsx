import { Stack } from "expo-router";

import { useWhoami } from "../../../src/api/queries";
import {
	useReminderSettings,
	useUpdateReminderSettings,
} from "../../../src/api/workspace";
import { ErrorState } from "../../../src/ui/components";
import { Screen } from "../../../src/ui/screen";
import { SettingsSection, SettingsSwitch } from "../../../src/ui/settings-list";
import { SettingsChoice } from "../../../src/ui/settings-list";
import {
	ChoiceSection,
	ListSkeleton,
	NoteRow,
	notifyError,
} from "../../../src/workspace/components";
import {
	digestProblem,
	digestSlice,
	logProblem,
	logSlice,
	MAX_MONTH_END_DAYS_BEFORE,
	MAX_NUDGE_DAYS,
	monthEndProblem,
	monthEndSlice,
	nudgeProblem,
	nudgeSlice,
	orderedWeekdays,
	toggleIn,
	LATEST_TIME,
	EARLIEST_TIME,
} from "../../../src/workspace/reminders/model";
import {
	MemberTypesSection,
	ReminderBlock,
	StepperRow,
	TimeSection,
} from "../../../src/workspace/reminders/parts";

const LOG_MODES = [
	{ value: "end_of_day", label: "At the end of each person's workday" },
	{ value: "fixed", label: "At a fixed time" },
] as const;

/** The reminder settings: four reminders, each with its own switch and
 *  fields, and the rule for people who never signed in. */
export default function RemindersScreen() {
	const settings = useReminderSettings();
	const whoami = useWhoami();
	const update = useUpdateReminderSettings();
	const data = settings.data;
	const days = orderedWeekdays(whoami.data?.weekStartsOn ?? 1);

	return (
		<>
			<Stack.Screen options={{ title: "Reminders" }} />
			<Screen
				topInset={false}
				refreshing={settings.isRefetching}
				onRefresh={() => void settings.refetch()}
			>
				{settings.isPending ? (
					<ListSkeleton rows={5} />
				) : !data ? (
					<ErrorState
						error={settings.error ?? new Error("The settings did not load.")}
						onRetry={() => void settings.refetch()}
					/>
				) : (
					<>
						<SettingsSection footer="Each switch saves at once. The other fields save with the Save row of their reminder.">
							<NoteRow>
								When each reminder goes out, and to whom. Nothing goes out
								before 07:00 or after 20:00, and nobody who is archived gets any
								of them.
							</NoteRow>
						</SettingsSection>

						<SettingsSection
							title="Who can get a reminder"
							footer="Archived people never get a reminder. People imported from another tool often have never signed in here, and a reminder about a timesheet they have never seen is noise. Off by default."
						>
							<SettingsSwitch
								title="People who have never signed in"
								value={data.includeNeverSignedIn}
								disabled={update.isPending}
								onValueChange={(includeNeverSignedIn) =>
									update.mutate(
										{ includeNeverSignedIn },
										{
											onError: (error) =>
												notifyError("Could not save the setting", error),
										},
									)
								}
							/>
						</SettingsSection>

						<ReminderBlock
							key={JSON.stringify(logSlice(data))}
							kind="log-reminder"
							title="Log reminder"
							description="A push notification to anyone who has logged less than their day, sent once a day."
							enabled={data.logEnabled}
							enabledPatch={(logEnabled) => ({ logEnabled })}
							saved={logSlice(data)}
							problemOf={logProblem}
						>
							{(draft, set) => (
								<>
									<ChoiceSection
										title="Send it"
										footer={
											draft.logMode === "fixed"
												? undefined
												: `The end of the workday comes from each person's own schedule, so it is not limited to ${EARLIEST_TIME} to ${LATEST_TIME}.`
										}
										options={LOG_MODES}
										value={draft.logMode}
										onChange={(logMode) => set({ logMode })}
									/>
									{draft.logMode === "fixed" ? (
										<TimeSection
											value={draft.logTime}
											onChange={(logTime) => set({ logTime })}
										/>
									) : null}
									<SettingsSection footer="1 to 100. At 100, anyone short of a full day gets it.">
										<StepperRow
											title="Remind when the day is below, as a percentage of the expected hours"
											value={draft.logBelowPct}
											min={1}
											max={100}
											suffix="%"
											onChange={(logBelowPct) => set({ logBelowPct })}
										/>
									</SettingsSection>
								</>
							)}
						</ReminderBlock>

						<ReminderBlock
							key={JSON.stringify(nudgeSlice(data))}
							kind="compliance-nudge"
							title="Slack nudge"
							description="A Slack message to people the Tracking rule calls behind: below the month's target so far by more than the tolerance set under Organization. Never on a weekend or a public holiday."
							enabled={data.nudgeEnabled}
							enabledPatch={(nudgeEnabled) => ({ nudgeEnabled })}
							saved={nudgeSlice(data)}
							problemOf={nudgeProblem}
						>
							{(draft, set) => (
								<>
									<SettingsSection
										title="Days"
										footer={`At most ${MAX_NUDGE_DAYS} days a week.`}
									>
										{days.map((weekday) => (
											<SettingsChoice
												key={weekday.day}
												title={weekday.label}
												selected={draft.nudgeWeekdays.includes(weekday.day)}
												onPress={() =>
													set({
														nudgeWeekdays: toggleIn(
															draft.nudgeWeekdays,
															weekday.day,
														).sort((a, b) => a - b),
													})
												}
											/>
										))}
									</SettingsSection>
									<TimeSection
										value={draft.nudgeTime}
										onChange={(nudgeTime) => set({ nudgeTime })}
									/>
									<MemberTypesSection
										value={draft.nudgeMemberTypes}
										onChange={(nudgeMemberTypes) => set({ nudgeMemberTypes })}
									/>
								</>
							)}
						</ReminderBlock>

						<ReminderBlock
							key={JSON.stringify(monthEndSlice(data))}
							kind="month-end"
							title="Month-end reminder"
							description="A Slack message before the month ends, to log anything still missing."
							enabled={data.monthEndEnabled}
							enabledPatch={(monthEndEnabled) => ({ monthEndEnabled })}
							saved={monthEndSlice(data)}
							problemOf={monthEndProblem}
						>
							{(draft, set) => (
								<>
									<SettingsSection
										title="Send it"
										footer={`0 to ${MAX_MONTH_END_DAYS_BEFORE}. At 0, it goes out on the last working day itself.`}
									>
										<StepperRow
											title="Working days before the last working day of the month"
											value={draft.monthEndDaysBefore}
											min={0}
											max={MAX_MONTH_END_DAYS_BEFORE}
											onChange={(monthEndDaysBefore) =>
												set({ monthEndDaysBefore })
											}
										/>
									</SettingsSection>
									<TimeSection
										value={draft.monthEndTime}
										onChange={(monthEndTime) => set({ monthEndTime })}
									/>
									<SettingsSection footer="Behind means below the Slack nudge's percentage.">
										<SettingsSwitch
											title="Only to people who are behind pace"
											value={draft.monthEndOnlyBehind}
											onValueChange={(monthEndOnlyBehind) =>
												set({ monthEndOnlyBehind })
											}
										/>
									</SettingsSection>
									<MemberTypesSection
										value={draft.monthEndMemberTypes}
										onChange={(monthEndMemberTypes) =>
											set({ monthEndMemberTypes })
										}
									/>
								</>
							)}
						</ReminderBlock>

						<ReminderBlock
							key={JSON.stringify(digestSlice(data))}
							kind="admin-digest"
							title="Admin digest"
							description="A weekly Slack summary to every admin: who has logged nothing, and who is behind pace."
							enabled={data.digestEnabled}
							enabledPatch={(digestEnabled) => ({ digestEnabled })}
							saved={digestSlice(data)}
							problemOf={digestProblem}
						>
							{(draft, set) => (
								<>
									<ChoiceSection
										title="Day"
										options={days.map((weekday) => ({
											value: weekday.day,
											label: weekday.label,
										}))}
										value={draft.digestWeekday}
										onChange={(digestWeekday) => set({ digestWeekday })}
									/>
									<TimeSection
										value={draft.digestTime}
										onChange={(digestTime) => set({ digestTime })}
									/>
								</>
							)}
						</ReminderBlock>
					</>
				)}
			</Screen>
		</>
	);
}
