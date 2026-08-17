import { SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { springProductive } from "#/lib/motion.ts";
import { githubConnectionStatusQuery } from "#/queries/github.ts";
import { googleCalendarStatusQuery } from "#/queries/google-calendar.ts";
import { integrationSettingsQuery } from "#/queries/integration-settings.ts";

// "a", "a and b", "a, b and c" — for stitching the gap phrases into one sentence.
function joinAnd(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? "";
	return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// A gentle, dismiss-once prompt on the dashboard: while Farmer *can* log your
// meetings and commits for you, that only happens once GitHub / Google Calendar
// are connected and their auto-sync toggles are on. If any of that is missing we
// nudge the user toward the integrations page. Dismissal is remembered per-org
// in localStorage so it never comes back once waved away.
export function AutoTrackNag({ orgSlug }: { orgSlug: string }) {
	const storageKey = `farmer:auto-track-nag-dismissed:${orgSlug}`;

	// Start hidden and only reveal after we've read localStorage on the client —
	// this keeps SSR/first-hydration output (nothing) identical on both sides.
	const [dismissed, setDismissed] = useState(true);
	useEffect(() => {
		try {
			setDismissed(window.localStorage.getItem(storageKey) === "1");
		} catch {
			setDismissed(false);
		}
	}, [storageKey]);

	// A dismissed user never pays for these fetches (both hit external APIs).
	const github = useQuery({
		...githubConnectionStatusQuery(orgSlug),
		enabled: !dismissed,
		staleTime: 5 * 60_000,
	});
	const google = useQuery({
		...googleCalendarStatusQuery(orgSlug),
		enabled: !dismissed,
		staleTime: 5 * 60_000,
	});
	const settings = useQuery({
		...integrationSettingsQuery(orgSlug),
		enabled: !dismissed,
		staleTime: 5 * 60_000,
	});

	// Derive the message as a plain value (or null when there's nothing to nag
	// about) rather than early-returning: the component must keep rendering the
	// AnimatePresence wrapper so the banner can animate *out* on dismiss instead
	// of vanishing the instant `message` becomes null.
	const message = ((): { title: string; body: string } | null => {
		if (dismissed) return null;
		// Decide only once we actually know the state — no flash of an empty nag.
		if (!github.data || !google.data || !settings.data) return null;

		const githubConnected = github.data.connected;
		const googleConnected = google.data.connected;

		if (!githubConnected && !googleConnected) {
			// Nothing linked yet → a single combined connections nag rather than
			// itemising each service and toggle.
			return {
				title: "Connect your integrations",
				body: "Link GitHub and Google Calendar so Farmer logs your commits and meetings automatically.",
			};
		}

		// Partial state — name exactly what's still missing. Two kinds of gap: an
		// account not yet linked, or one that's linked but has its auto-sync toggle
		// off. Group the unlinked accounts under a single "connect …" verb so the
		// copy never reads "connect GitHub and connect …".
		const toConnect: string[] = [];
		const toEnable: string[] = [];
		if (!githubConnected) toConnect.push("GitHub");
		else if (!settings.data.githubSyncCommitsAsWorkTime)
			toEnable.push("auto-log your commits");
		if (!googleConnected) toConnect.push("Google Calendar");
		else if (!settings.data.googleAutoSyncMeetings)
			toEnable.push("sync your meetings");

		const clauses: string[] = [];
		if (toConnect.length > 0) clauses.push(`connect ${joinAnd(toConnect)}`);
		clauses.push(...toEnable);
		if (clauses.length === 0) return null;

		const sentence = joinAnd(clauses);
		return {
			title: "Automate your time tracking",
			body: `${sentence.charAt(0).toUpperCase() + sentence.slice(1)} so your meetings and commits log themselves.`,
		};
	})();

	const handleDismiss = () => {
		setDismissed(true);
		try {
			window.localStorage.setItem(storageKey, "1");
		} catch {
			// Private-mode / disabled storage: just hide it for this session.
		}
	};

	return (
		// initial={false} suppresses an animation on the dashboard's first paint;
		// the banner only appears *after* the async status queries resolve, so it's
		// added to AnimatePresence later and still animates in from height 0. The
		// height collapse (not just a fade) makes the surrounding page content
		// reflow smoothly as the full-bleed banner unfolds / folds away.
		<AnimatePresence initial={false}>
			{message && (
				<motion.div
					key="auto-track-nag"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={springProductive}
					// The negative insets cancel `island-pad` exactly, so this banner
					// meets the island's own edge: 1rem all round below sm, and
					// 1.75rem vertical / 2rem horizontal at sm and up. mb matches
					// |−mt| at each breakpoint so when the height springs to 0 the row
					// below lands exactly where it sits once this element unmounts —
					// no final reflow pop.
					className="-mx-4 -mt-4 mb-4 overflow-hidden border-b bg-secondary sm:-mx-8 sm:-mt-7 sm:mb-7"
				>
					<div className="flex items-center gap-3 px-4 py-3 sm:px-8">
						<SparkleIcon className="size-4 shrink-0 text-primary" />
						<div className="min-w-0 flex-1">
							<p className="text-base font-medium">{message.title}</p>
							<p className="text-sm text-muted-foreground">{message.body}</p>
						</div>
						<Button
							size="sm"
							nativeButton={false}
							render={
								<Link to="/$orgSlug/settings/integrations" params={{ orgSlug }}>
									Set up
								</Link>
							}
						/>
						<button
							type="button"
							onClick={handleDismiss}
							aria-label="Dismiss"
							className="quiet shrink-0 rounded-md p-1"
						>
							<XIcon weight="regular" className="size-4" />
						</button>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
