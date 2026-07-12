import { Loader2 } from "lucide-react";

/**
 * App-wide fallback for `defaultPendingComponent`. Shown while a route's
 * loader/query is in flight past the pending-minMs threshold.
 */
export function RoutePending() {
	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-10 text-center">
			<Loader2 className="size-6 animate-spin text-muted-foreground" />
		</div>
	);
}
