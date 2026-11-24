import { StartClient } from "@tanstack/react-start/client";
import posthog from "posthog-js";
import { StrictMode, startTransition } from "react";
import { type HydrationOptions, hydrateRoot } from "react-dom/client";

const TRANSLATED = ["translated-ltr", "translated-rtl"];

/**
 * Report an error that React recovered from, such as a hydration mismatch
 * (React error #418). The production message names no component, so the
 * event holds the component stack. Chrome's page translation edits the DOM
 * and the `lang` attribute, so the event says if it was on.
 *
 * Not `reportError`: React's default handler calls it, and the `error` event
 * that it fires is already captured by posthog-js. This handler replaces
 * the default, so each error is captured one time.
 */
const onRecoverableError: NonNullable<
	HydrationOptions["onRecoverableError"]
> = (error, errorInfo) => {
	if (posthog.__loaded) {
		const classes = document.documentElement.classList;
		posthog.captureException(error, {
			react_component_stack: errorInfo.componentStack,
			html_lang: document.documentElement.lang,
			html_translated: TRANSLATED.some((name) => classes.contains(name)),
			pathname: location.pathname,
		});
	}
	console.error(error);
};

// The default entry of TanStack Start, plus `onRecoverableError`.
startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
		{ onRecoverableError },
	);
});
