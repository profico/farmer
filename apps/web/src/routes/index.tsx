import { createFileRoute, redirect } from "@tanstack/react-router";

import { FrontPage } from "#/components/site/front-page.tsx";
import { loadSiteVisitor } from "#/components/site/site-chrome.tsx";
import { getHomeRedirect } from "#/server/config.ts";
import { getLatestReleaseNote } from "#/server/releases.ts";

export const Route = createFileRoute("/")({
	// `HOMEPAGE_ENABLED` decides what `/` is, in every mode — see
	// `getHomeRedirect`. Off (the default), a deployment is somebody's
	// timesheet and `/` goes straight into the workspace, through sign-in when
	// needed. On, it is the product page, rendered for everyone, signed in or
	// not; its CTAs say who the viewer is (`loadSiteVisitor`).
	beforeLoad: async () => {
		const orgSlug = await getHomeRedirect();
		if (orgSlug) throw redirect({ to: "/$orgSlug", params: { orgSlug } });
	},
	// The release read fails soft to null, so it never breaks the page.
	loader: async () => {
		const [visitor, release] = await Promise.all([
			loadSiteVisitor(),
			getLatestReleaseNote(),
		]);
		return { visitor, release };
	},
	head: () => ({
		meta: [{ title: "Farmer · Time tracking that fills itself in" }],
	}),
	component: Home,
});

function Home() {
	const { visitor, release } = Route.useLoaderData();
	return <FrontPage visitor={visitor} release={release} />;
}
