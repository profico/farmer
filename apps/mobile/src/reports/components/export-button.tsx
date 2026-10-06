import { useState } from "react";

import { ActionButton } from "../../ui/components";
import { showDialog } from "../../ui/dialog";
import type { Csv } from "../csv";
import { shareCsv } from "../share";

/**
 * "Export CSV": builds the file from the rows on the screen, as the web
 * does, and opens the share sheet. `name` has no extension.
 */
export function ExportButton({
	name,
	build,
	disabled,
}: {
	name: string;
	/** Null while the rows load. */
	build: (() => Csv) | null;
	disabled?: boolean;
}) {
	const [busy, setBusy] = useState(false);
	const run = () => {
		if (!build) return;
		setBusy(true);
		shareCsv(name, build())
			.catch((error: Error) =>
				showDialog("Could not export", error.message || "Try again."),
			)
			.finally(() => setBusy(false));
	};
	return (
		<ActionButton
			label="Export CSV"
			variant="outlined"
			onPress={run}
			disabled={disabled || busy || !build}
		/>
	);
}
