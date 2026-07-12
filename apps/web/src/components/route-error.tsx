import type { ErrorComponentProps } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";

/**
 * App-wide fallback for `defaultErrorComponent` / route `errorComponent`.
 * Any `useSuspenseQuery`/loader rejection anywhere under the router lands
 * here instead of TanStack Router's unstyled default error screen.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
	const message = error instanceof Error ? error.message : String(error);

	return (
		<div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-10 text-center">
			<span className="flex size-13 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
				<AlertTriangle className="size-6" />
			</span>
			<p className="mt-4 text-[15px] font-semibold">Something went wrong</p>
			<p className="mt-1.5 max-w-[320px] text-sm leading-relaxed text-muted-foreground">
				This page ran into an unexpected error. Try again, and if it keeps
				happening, let us know.
			</p>
			{import.meta.env.DEV && message && (
				<pre className="mt-3 max-w-[420px] overflow-x-auto rounded-lg bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
					{message}
				</pre>
			)}
			<Button
				variant="outline"
				size="sm"
				className="mt-4"
				onClick={() => {
					reset();
				}}
			>
				<RefreshCw className="size-3.5" />
				Try again
			</Button>
		</div>
	);
}
