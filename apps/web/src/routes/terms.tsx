import { createFileRoute } from "@tanstack/react-router";

import { LegalDocument } from "#/components/site/legal.tsx";
import { loadProficoPage, SitePage } from "#/components/site/site-chrome.tsx";

export const Route = createFileRoute("/terms")({
	loader: loadProficoPage,
	head: () => ({ meta: [{ title: "Terms · Farmer" }] }),
	component: Page,
});

function Page() {
	const visitor = Route.useLoaderData();
	return (
		<SitePage visitor={visitor}>
			<LegalDocument doc="terms" />
		</SitePage>
	);
}
