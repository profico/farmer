import { useState } from "react";
import { Platform } from "react-native";

import { useWhoami } from "../../api/queries";
import { Skeleton } from "../../ui/components";
import { Inset } from "../../ui/screen";
import { SettingsSection, SettingsSwitch } from "../../ui/settings-list";
import { type PeriodSelection, resolvePeriod } from "../period";
import { PeriodPicker } from "./period-picker";

export type PeriodState = {
	selection: PeriodSelection;
	onChange: (selection: PeriodSelection) => void;
};

/** The chosen period of a screen. It starts at this month. */
export const usePeriodState = (): PeriodState => {
	const [selection, onChange] = useState<PeriodSelection>({});
	return { selection, onChange };
};

/** The days of the chosen period, from "today" on the server. Null until
 *  `whoami` is read. */
export const useRange = (selection: PeriodSelection) => {
	const whoami = useWhoami();
	if (!whoami.data) return null;
	const { from, to } = resolvePeriod(
		selection,
		whoami.data.today,
		whoami.data.weekStartsOn,
	);
	return { from, to };
};

const IOS = Platform.OS === "ios";

/** The line that explains the switch: the subtitle of the row on Android,
 *  and the footer of the section on iOS. */
const ARCHIVED_NOTE = "Leave the time of archived projects out";

/** The period picker of a report, and "Active projects only" where the
 *  report has projects. */
export function ReportControls({
	period,
	activeOnly,
}: {
	period: PeriodState;
	activeOnly?: { value: boolean; onChange: (value: boolean) => void };
}) {
	const whoami = useWhoami();
	return (
		<>
			<Inset>
				{whoami.data ? (
					<PeriodPicker
						selection={period.selection}
						onChange={period.onChange}
						today={whoami.data.today}
						weekStartsOn={whoami.data.weekStartsOn}
					/>
				) : (
					<Skeleton height={88} />
				)}
			</Inset>
			{activeOnly ? (
				<SettingsSection footer={IOS ? ARCHIVED_NOTE : undefined}>
					<SettingsSwitch
						title="Active projects only"
						subtitle={IOS ? undefined : ARCHIVED_NOTE}
						value={activeOnly.value}
						onValueChange={activeOnly.onChange}
					/>
				</SettingsSection>
			) : null}
		</>
	);
}
