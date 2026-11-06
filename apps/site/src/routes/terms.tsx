import { createFileRoute } from "@tanstack/react-router";

import { LegalDocument } from "#/components/site/legal.tsx";
import { SitePage } from "#/components/site/site-chrome.tsx";

export const Route = createFileRoute("/terms")({
	head: () => ({ meta: [{ title: "Terms · Farmer" }] }),
	component: Page,
});

function Page() {
	return (
		<SitePage>
			<LegalDocument doc="terms" />
		</SitePage>
	);
}
