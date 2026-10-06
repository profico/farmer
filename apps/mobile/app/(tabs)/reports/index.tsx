import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAccess } from "../../../src/api/capabilities";
import { scope, useWorkspace } from "../../../src/api/queries";
import { AbsenceReport } from "../../../src/reports/absence";
import { usePeriodState } from "../../../src/reports/components/controls";
import { OvertimeReport } from "../../../src/reports/overtime";
import { TimeReport } from "../../../src/reports/time";
import { TrackingReport } from "../../../src/reports/tracking";
import { Inset, Screen } from "../../../src/ui/screen";
import {
	type SegmentOption,
	SegmentedControl,
} from "../../../src/ui/segmented";

type Part = "time" | "overtime" | "tracking" | "absence";

const PARTS: SegmentOption<Part>[] = [
	{ value: "time", label: "Time" },
	{ value: "overtime", label: "Overtime" },
	{ value: "tracking", label: "Tracking" },
	{ value: "absence", label: "Absence" },
];

/**
 * The Reports tab: one report at a time, chosen with a segmented control.
 * Each report is a component in `src/reports/`. The server limits each one
 * to what the person may see. Time, Overtime and Absence share one period,
 * so a move from one to the next keeps it. A Server before API version 2
 * has only the tracking figures, so it gets no control.
 */
export default function ReportsScreen() {
	const access = useAccess();
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const [chosen, setChosen] = useState<Part>("time");
	const [refreshing, setRefreshing] = useState(false);
	const period = usePeriodState();
	const [activeOnly, setActiveOnly] = useState(false);
	const part = access.fullApi ? chosen : "tracking";

	// A pull reads again every query the report on screen uses.
	const refresh = () => {
		setRefreshing(true);
		void queryClient
			.refetchQueries({ queryKey: scope(w), type: "active" })
			.finally(() => setRefreshing(false));
	};

	return (
		<Screen
			title="Reports"
			largeTitle
			refreshing={refreshing}
			onRefresh={refresh}
		>
			{access.fullApi ? (
				<Inset>
					<SegmentedControl options={PARTS} value={part} onChange={setChosen} />
				</Inset>
			) : null}
			{part === "time" ? (
				<TimeReport
					period={period}
					activeOnly={activeOnly}
					onActiveOnly={setActiveOnly}
				/>
			) : part === "overtime" ? (
				<OvertimeReport
					period={period}
					activeOnly={activeOnly}
					onActiveOnly={setActiveOnly}
				/>
			) : part === "absence" ? (
				<AbsenceReport period={period} />
			) : (
				<TrackingReport />
			)}
		</Screen>
	);
}
