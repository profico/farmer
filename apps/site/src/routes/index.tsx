import { createFileRoute } from "@tanstack/react-router";

import { FrontPage } from "#/components/site/front-page.tsx";
import { commitKind } from "#/lib/release-notes.ts";
import { webChanges } from "#/lib/releases.ts";

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [{ title: "Farmer · Time tracking that fills itself in" }],
	}),
	component: Home,
});

function Home() {
	return (
		<FrontPage
			updatedAt={
				webChanges.commits.find(
					(commit) => commitKind(commit.subject) === "web",
				)?.committedAt || null
			}
		/>
	);
}
