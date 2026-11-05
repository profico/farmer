import { ArrowsClockwiseIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import {
	Link,
	useParams,
	type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	ErrorCard,
	ErrorIcon,
	ErrorRef,
	ErrorScreen,
} from "#/components/error-screen.tsx";
import { Button } from "#/components/ui/button.tsx";
import { useInsideSidebar } from "#/components/ui/sidebar.tsx";
import {
	browserEnv,
	claimStaleChunkFault,
	isStaleChunkError,
	isReloadPending,
	reloadIfStaleChunk,
} from "#/lib/stale-chunk.ts";

/** A short, per-render correlation id plus a UTC timestamp, so a person can
 *  read it to an administrator over chat without attaching a screenshot. Not
 *  wired to a real error-tracking id (Sentry etc. keep their own) — this is
 *  just something a person can say out loud. */
const makeErrorRef = () => {
	const stamp = new Date().toISOString().replace("T", " ").slice(0, 16);
	const id = Math.random().toString(36).slice(2, 10);
	return `${id} · ${stamp} UTC`;
};

/**
 * App-wide fallback for `defaultErrorComponent` / route `errorComponent`.
 * Any `useSuspenseQuery`/loader rejection anywhere under the router lands
 * here instead of TanStack Router's unstyled default error screen.
 *
 * Renders both inside the workspace layout and with no layout at all (the
 * root route itself threw); `ErrorScreen` draws the frame for each.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
	const posthog = usePostHog();
	const message = error instanceof Error ? error.message : String(error);
	const [errorRef] = useState(makeErrorRef);
	const inside = useInsideSidebar();
	const { orgSlug } = useParams({ strict: false });

	useEffect(() => {
		// A chunk that a deploy removed is not a fault: reload to get the new
		// index. The page that loads next sends one `stale_chunk_reloaded` event.
		// When the guard blocks the reload, the error is a real fault and goes on.
		// A follow-on error of a pending reload (a module that came back empty)
		// is part of the same event and is not a fault either.
		const env = browserEnv();
		if (reloadIfStaleChunk(error, env) || isReloadPending(env)) return;
		// A stale chunk error is cached by the lazy component and thrown again on
		// each render, so it is captured once per page load.
		if (claimStaleChunkFault(error)) posthog.captureException(error);
	}, [error, posthog]);

	return (
		<ErrorScreen>
			<ErrorCard
				icon={
					<ErrorIcon tone="fault">
						<WarningCircleIcon size={22} />
					</ErrorIcon>
				}
				title={inside ? "This page did not load" : "Farmer did not load"}
				actions={
					<>
						<Button
							onClick={() => {
								posthog.capture("route_error_retry_clicked");
								// A stale chunk error is cached by the lazy component, so a
								// re-render throws it again. Only a new page can fix it.
								if (isStaleChunkError(error)) browserEnv().reload();
								else reset();
							}}
						>
							<ArrowsClockwiseIcon aria-hidden />
							Try again
						</Button>
						{inside && orgSlug && (
							<Button
								variant="outline"
								nativeButton={false}
								render={
									<Link to="/$orgSlug" params={{ orgSlug }}>
										Go to today
									</Link>
								}
							/>
						)}
					</>
				}
				after={<ErrorRef value={errorRef} />}
			>
				<p className="text-sm text-muted-foreground">
					The server had a problem. Your time entries are safe. If it keeps
					happening, send the ref below to your administrator.
				</p>
				{import.meta.env.DEV && message && (
					<pre className="mt-2 overflow-x-auto font-mono text-xs text-muted-foreground">
						{message}
					</pre>
				)}
			</ErrorCard>
		</ErrorScreen>
	);
}
