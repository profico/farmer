import { createFileRoute } from "@tanstack/react-router";

import {
	installOrigin,
	plainText,
	psInstallScript,
	shInstallScript,
	wantsPowerShell,
} from "#/server/cli-install.ts";

/**
 * `GET /cli` — the install script, picked by who is asking.
 *
 * One short address for both commands on Settings → Integrations:
 * `curl -fsSL <origin>/cli | sh` and `irm <origin>/cli | iex`. PowerShell names
 * itself in its User-Agent and curl does not, so that is the whole test. A
 * browser gets the sh script as text, which is a fine thing to read before
 * piping it anywhere. `/cli/install.sh` and `/cli/install.ps1` serve each one
 * by name, for anybody who wants to download and read it first.
 *
 * `no-store`, because the script names this deployment's origin, and a cache
 * in between that kept an old one would install from the wrong server.
 */
export const Route = createFileRoute("/cli/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");

				if (!isCliEnabled()) return plainText("Not found", 404);
				const origin = installOrigin(request);

				return plainText(
					wantsPowerShell(request)
						? psInstallScript(origin)
						: shInstallScript(origin),
				);
			},
		},
	},
});
