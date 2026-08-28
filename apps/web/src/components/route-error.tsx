import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Button } from "#/components/ui/button.tsx";

/**
 * App-wide fallback for `defaultErrorComponent` / route `errorComponent`.
 * Any `useSuspenseQuery`/loader rejection anywhere under the router lands
 * here instead of TanStack Router's unstyled default error screen.
 *
 * Left-aligned, no warning glyph, no centred column. An error screen is still a
 * page of the app, and the previous version — a red-tinted icon tile floating in
 * the middle of the viewport — announced the failure far more loudly than the
 * failure usually deserves. The sentence says what happened; the button fixes
 * it.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
	const message = error instanceof Error ? error.message : String(error);

	return (
		<div className="island island-pad flex-1">
			<div className="eyebrow-lg">Error</div>
			<h1 className="h2 mt-3">Something went wrong</h1>
			<p className="lede mt-2 max-w-[52ch]">
				This page ran into an unexpected error. Try again, and if it keeps
				happening, let us know.
			</p>
			{import.meta.env.DEV && message && (
				<pre className="mono mt-5 max-w-[68ch] overflow-x-auto border-t pt-4 text-xs text-muted-foreground">
					{message}
				</pre>
			)}
			<Button
				variant="outline"
				size="sm"
				className="mt-6"
				onClick={() => {
					reset();
				}}
			>
				<ArrowsClockwiseIcon weight="regular" className="size-3.5" />
				Try again
			</Button>
		</div>
	);
}
