import { EmptyState } from "../ui/components";

/** The Absence report. A placeholder until its screen is built. */
export function AbsenceReport() {
	return (
		<EmptyState
			icon="info"
			title="Absence"
			message="This report is not in the app yet. Use Farmer on the web for now."
		/>
	);
}
