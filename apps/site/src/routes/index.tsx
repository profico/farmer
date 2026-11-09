import { createFileRoute } from "@tanstack/react-router";

import { FrontPage } from "#/components/site/front-page.tsx";
import { releases } from "#/lib/releases.ts";

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [{ title: "Farmer · Time tracking that fills itself in" }],
	}),
	component: Home,
});

function Home() {
	return (
		<FrontPage
			release={releases.find((release) => release.kind === "web") ?? null}
		/>
	);
}
