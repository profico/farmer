import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";

/**
 * App-wide fallback for `defaultNotFoundComponent`. Shown for unmatched
 * routes and explicit `notFound()` throws from loaders.
 */
export function RouteNotFound() {
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-10 text-center">
			<span className="flex size-13 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
				<Compass className="size-6" />
			</span>
			<p className="mt-4 text-[15px] font-semibold">Page not found</p>
			<p className="mt-1.5 max-w-[320px] text-sm leading-relaxed text-muted-foreground">
				The page you're looking for doesn't exist or may have been moved.
			</p>
			<Button
				variant="outline"
				size="sm"
				className="mt-4"
				render={<Link to="/" />}
				nativeButton={false}
			>
				Back to home
			</Button>
		</div>
	);
}
