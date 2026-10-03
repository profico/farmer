import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { SiteBrand, useEmSheen } from "#/components/site/site-chrome.tsx";
import { browserEnv, reloadIfStaleChunk } from "#/lib/stale-chunk.ts";

import "./site/errors.css";

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
 * Renders both fully outside the app shell (the root route itself threw) and
 * nested inside a matched route's own layout, so — like `RouteNotFound` — it
 * draws a complete page of its own rather than assuming any ancestor chrome,
 * and never calls a loader (`SiteBrand` needs no visitor).
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
	const posthog = usePostHog();
	const message = error instanceof Error ? error.message : String(error);
	const [errorRef] = useState(makeErrorRef);
	const pageRef = useRef<HTMLDivElement>(null);
	useEmSheen(pageRef);

	useEffect(() => {
		// A chunk that a deploy removed is not a fault: reload to get the new
		// index. The page that loads next sends one `stale_chunk_reloaded` event.
		// When the guard blocks the reload, the error is a real fault and goes on.
		if (reloadIfStaleChunk(error, browserEnv())) return;
		posthog.captureException(error);
	}, [error, posthog]);

	return (
		<div ref={pageRef} className="fm-site fm-error-page">
			<header className="fm-error-header">
				<SiteBrand size={24} />
			</header>
			<main className="fm-error-main">
				<span className="fm-mono fm-error-code">500 · server error</span>
				<h1 className="fm-error-h1">
					Something broke <span className="fm-em">on our side.</span>
				</h1>
				<p className="fm-lede fm-error-lede">
					Your time entries are safe. Try again in a moment.
				</p>
				<div className="fm-error-actions">
					<button
						type="button"
						className="fm-btn"
						onClick={() => {
							posthog.capture("route_error_retry_clicked");
							reset();
						}}
					>
						<ArrowsClockwiseIcon size={16} aria-hidden />
						Try again
					</button>
				</div>
				<p className="fm-error-ref">
					If it keeps happening, send this to your administrator:{" "}
					<span className="fm-code">ref {errorRef}</span>
				</p>
				{import.meta.env.DEV && message && (
					<pre className="fm-mono fm-error-detail">{message}</pre>
				)}
			</main>
		</div>
	);
}
