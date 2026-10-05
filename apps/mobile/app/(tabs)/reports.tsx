import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useAccess } from "../../src/api/capabilities";
import { scope, useWorkspace } from "../../src/api/queries";
import { AbsenceReport } from "../../src/reports/absence";
import { OvertimeReport } from "../../src/reports/overtime";
import { TimeReport } from "../../src/reports/time";
import { TrackingReport } from "../../src/reports/tracking";
import { Inset, Screen } from "../../src/ui/screen";
import { type SegmentOption, SegmentedControl } from "../../src/ui/segmented";

type Part = "time" | "overtime" | "tracking" | "absence";

const PARTS: SegmentOption<Part>[] = [
	{ value: "time", label: "Time" },
	{ value: "overtime", label: "Overtime" },
	{ value: "tracking", label: "Tracking" },
	{ value: "absence", label: "Absence" },
];

/**
 * The Reports tab: one report at a time, chosen with a segmented control.
 * Each report is a component in `src/reports/`. A Server before API version
 * 2 has only the tracking figures, so it gets no control.
 */
export default function ReportsScreen() {
	const access = useAccess();
	const w = useWorkspace();
	const queryClient = useQueryClient();
	const [chosen, setChosen] = useState<Part>("tracking");
	const [refreshing, setRefreshing] = useState(false);
	const part = access.fullApi ? chosen : "tracking";

	// A pull reads again every query the report on screen uses.
	const refresh = () => {
		setRefreshing(true);
		void queryClient
			.refetchQueries({ queryKey: scope(w), type: "active" })
			.finally(() => setRefreshing(false));
	};

	return (
		<Screen title="Reports" refreshing={refreshing} onRefresh={refresh}>
			{access.fullApi ? (
				<Inset>
					<SegmentedControl options={PARTS} value={part} onChange={setChosen} />
				</Inset>
			) : null}
			{part === "time" ? (
				<TimeReport />
			) : part === "overtime" ? (
				<OvertimeReport />
			) : part === "absence" ? (
				<AbsenceReport />
			) : (
				<TrackingReport />
			)}
		</Screen>
	);
}
