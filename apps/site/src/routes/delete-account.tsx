import { createFileRoute } from "@tanstack/react-router";

import { LegalDocument } from "#/components/site/legal.tsx";
import { SitePage } from "#/components/site/site-chrome.tsx";

export const Route = createFileRoute("/delete-account")({
	head: () => ({ meta: [{ title: "Delete your account · Farmer" }] }),
	component: Page,
});

function Page() {
	return (
		<SitePage>
			<LegalDocument doc="deleteAccount" />
		</SitePage>
	);
}
