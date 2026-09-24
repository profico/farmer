import { createFileRoute } from "@tanstack/react-router";

import { FrontDoor } from "#/components/site/front-door.tsx";
import { FrontPage } from "#/components/site/front-page.tsx";
import { loadSiteVisitor } from "#/components/site/site-chrome.tsx";
import { getFrontDoor } from "#/server/config.ts";
import { getLatestReleaseNote } from "#/server/releases.ts";

export const Route = createFileRoute("/")({
	// Public homepage — rendered for everyone, signed in or not, in every mode.
	// It never redirects. Single-org mode used to bounce every visitor straight
	// through to the workspace (and, signed out, on to `/login` and from there to
	// Google), which meant a deployment had no reachable front door at all: no
	// address you could type to get a page instead of a round trip, and nowhere
	// for a sign-in screen offering anything other than Google to live.
	//
	// So the loader resolves who the viewer is and lets the CTAs say it — see
	// `loadSiteVisitor` — and, in single-org mode, which organization this
	// deployment belongs to: that draws the Front Door instead of the marketing
	// page. The release read fails soft to null, so it never breaks the page,
	// and it is skipped for the Front Door, which never shows it: a GitHub
	// request there would only spend the anonymous budget.
	loader: async () => {
		const frontDoorRead = getFrontDoor();
		const [visitor, frontDoor, release] = await Promise.all([
			loadSiteVisitor(),
			frontDoorRead,
			frontDoorRead.then((door) => (door ? null : getLatestReleaseNote())),
		]);
		return { visitor, release, frontDoor };
	},
	head: ({ loaderData }) => ({
		meta: [
			{
				title: loaderData?.frontDoor
					? `${loaderData.frontDoor.name} · Farmer`
					: "Farmer · Time tracking that fills itself in",
			},
		],
	}),
	component: Home,
});

function Home() {
	const { visitor, release, frontDoor } = Route.useLoaderData();
	if (frontDoor) return <FrontDoor visitor={visitor} org={frontDoor} />;
	return <FrontPage visitor={visitor} release={release} />;
}
