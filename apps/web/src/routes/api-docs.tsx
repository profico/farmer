import { CircleNotchIcon } from "@phosphor-icons/react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";

import { loadSiteVisitor, SitePage } from "#/components/site/site-chrome.tsx";

const ApiReference = lazy(() => import("#/components/site/api-reference.tsx"));

export const Route = createFileRoute("/api-docs")({
	loader: loadSiteVisitor,
	head: () => ({ meta: [{ title: "API · Farmer" }] }),
	component: Page,
});

function Page() {
	const visitor = Route.useLoaderData();
	const [loaded, setLoaded] = useState(false);
	return (
		<SitePage visitor={visitor}>
			<div className="fm-api-docs" data-loaded={loaded || undefined}>
				<output className="fm-api-docs-loading">
					<CircleNotchIcon size={18} aria-hidden />
					Loading the API reference
				</output>
				<div className="fm-api-docs-body">
					{/* Scalar reads `window` as it starts, so it renders in the
					    browser only. */}
					<ClientOnly>
						<Suspense fallback={null}>
							<ApiReference
								onLoaded={() => setLoaded(true)}
								signedIn={visitor.user !== null}
								orgSlug={visitor.orgSlug}
							/>
						</Suspense>
					</ClientOnly>
				</div>
			</div>
		</SitePage>
	);
}
