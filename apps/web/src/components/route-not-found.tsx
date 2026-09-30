import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { SiteBrand, useEmSheen } from "#/components/site/site-chrome.tsx";

import "./site/errors.css";

/**
 * App-wide fallback for `defaultNotFoundComponent`. Shown for unmatched
 * routes and explicit `notFound()` throws from loaders — both fully outside
 * the app shell (a mistyped URL) and nested inside a matched route's own
 * layout (`__root.tsx`'s `notFoundComponent`), so it draws a complete page
 * of its own rather than assuming any ancestor chrome. `SiteBrand` needs no
 * visitor, unlike `SiteHeader` — an error boundary cannot run a loader.
 */
export function RouteNotFound() {
	const pageRef = useRef<HTMLDivElement>(null);
	useEmSheen(pageRef);
	return (
		<div ref={pageRef} className="fm-site fm-error-page">
			<header className="fm-error-header">
				<SiteBrand size={24} />
			</header>
			<main className="fm-error-main">
				<span className="fm-mono fm-error-code">404 · not found</span>
				<h1 className="fm-error-h1">
					This page isn't <span className="fm-em">on the timesheet.</span>
				</h1>
				<p className="fm-lede fm-error-lede">
					The address may be mistyped, or the page moved. Nothing was logged.
				</p>
				<div className="fm-error-actions">
					<Link className="fm-btn" to="/">
						Back to home
						<ArrowRightIcon size={16} aria-hidden />
					</Link>
				</div>
			</main>
		</div>
	);
}
