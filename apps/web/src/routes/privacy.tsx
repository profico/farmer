import { createFileRoute } from "@tanstack/react-router";

import { LegalDocument } from "#/components/site/legal.tsx";
import { loadSiteVisitor, SitePage } from "#/components/site/site-chrome.tsx";

export const Route = createFileRoute("/privacy")({
	loader: loadSiteVisitor,
	head: () => ({ meta: [{ title: "Privacy · Farmer" }] }),
	component: Page,
});

function Page() {
	const visitor = Route.useLoaderData();
	return (
		<SitePage visitor={visitor}>
			<LegalDocument doc="privacy" />
		</SitePage>
	);
}
