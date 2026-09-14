import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { CLI_RELEASE_ASSETS, plainText } from "#/server/cli-install.ts";

const assetName = z.enum(CLI_RELEASE_ASSETS);

/**
 * `GET /cli/download/<asset>` — a 302 to GitHub's signed URL for one file of
 * the newest CLI release. The lookup and the reasons it never proxies are in
 * `server/cli-releases.ts`.
 *
 * Unauthenticated, like the script that calls it: an install happens before
 * the person has a CLI to sign in with. What it hands out is a binary the
 * operator has published for exactly this, and the name allowlist keeps it from
 * being a way to read any other release asset in the repository.
 *
 * Every answer but the redirect is plain text, because the install script
 * prints the body of a failed download — so "the GitHub App is not installed
 * on the repository" reaches the person running the script in words, not as a bare 503.
 */
export const Route = createFileRoute("/cli/download/$asset")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const { isCliEnabled } = await import("@farmer/core/lib/cli-flag");
				if (!isCliEnabled()) return plainText("Not found", 404);

				const parsed = assetName.safeParse(params.asset);
				if (!parsed.success) {
					return plainText(
						`No CLI download is named "${params.asset}". The files are: ${CLI_RELEASE_ASSETS.join(", ")}.`,
						404,
					);
				}

				const { resolveCliDownload } = await import("#/server/cli-releases.ts");
				const download = await resolveCliDownload(parsed.data);
				switch (download.kind) {
					case "redirect":
						return new Response(null, {
							status: 302,
							headers: {
								Location: download.location,
								"Cache-Control": "no-store",
							},
						});
					case "unconfigured":
						return plainText(
							"This Farmer server cannot hand out the CLI yet: it has no GitHub App configured (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY). Ask the person who runs it to set one up (see .env.example).",
							503,
						);
					case "not-installed":
						return plainText(
							`This Farmer server cannot hand out the CLI yet: its GitHub App is not installed on ${download.repo}. Ask the person who runs it to give the App access to that repository.`,
							503,
						);
					case "no-release":
						return plainText(
							"No Farmer CLI release has been published yet. Ask the person who runs this server to publish one (a cli-v* tag).",
							404,
						);
					case "missing-asset":
						return plainText(
							`The newest Farmer CLI release (${download.tag}) has no ${parsed.data}.`,
							404,
						);
					case "upstream-error":
						console.error("[cli-download]", download.detail);
						return plainText(
							"This Farmer server could not read the CLI release from GitHub. Try again in a minute; if it keeps happening, ask the person who runs it to check the GitHub App's access to the releases repository.",
							502,
						);
				}
			},
		},
	},
});
