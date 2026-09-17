import { createFileRoute } from "@tanstack/react-router";

import {
	installOrigin,
	plainText,
	psInstallScript,
} from "#/server/cli-install.ts";

/**
 * `GET /cli/install.ps1` — the Windows installer by name, whatever the
 * User-Agent. `/cli` serves the same script to PowerShell; see that route, and
 * `install[.]sh.ts` for the bracket escape in the file name.
 */
export const Route = createFileRoute("/cli/install.ps1")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");

				if (!isCliEnabled()) return plainText("Not found", 404);

				return plainText(psInstallScript(installOrigin(request)));
			},
		},
	},
});
