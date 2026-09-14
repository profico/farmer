import { createFileRoute } from "@tanstack/react-router";

import {
	installOrigin,
	plainText,
	shInstallScript,
} from "#/server/cli-install.ts";

/**
 * `GET /cli/install.sh` — the macOS and Linux installer by name. `/cli` serves
 * the same script to anything that is not PowerShell; see that route.
 *
 * The file name is `install[.]sh.ts`: a dot in a TanStack Router file name is a
 * path separator, and the brackets make it a literal dot (the same escape as
 * `routes/[.]well-known/`).
 */
export const Route = createFileRoute("/cli/install.sh")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");
				if (!isCliEnabled()) return plainText("Not found", 404);
				return plainText(shInstallScript(installOrigin(request)));
			},
		},
	},
});
