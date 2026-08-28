import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button.tsx";

/**
 * App-wide fallback for `defaultNotFoundComponent`. Shown for unmatched
 * routes and explicit `notFound()` throws from loaders.
 */
export function RouteNotFound() {
	return (
		<div className="island island-pad flex-1">
			<div className="eyebrow-lg">404</div>
			<h1 className="h2 mt-3">Page not found</h1>
			<p className="lede mt-2 max-w-[52ch]">
				The page you're looking for doesn't exist, or may have been moved.
			</p>
			<Button
				variant="outline"
				size="sm"
				className="mt-6"
				render={<Link to="/" />}
				nativeButton={false}
			>
				Back to home
			</Button>
		</div>
	);
}
