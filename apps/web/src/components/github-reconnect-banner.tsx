import { GithubLogoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "#/components/ui/button.tsx";
import { useHeightTransition } from "#/lib/motion.ts";
import { githubConnectionStatusQuery } from "#/queries/github.ts";

// A GitHub grant that has been revoked, or has expired, is refused forever.
// Everything downstream of it — the commit and pull-request sync, the entry
// dialog's pickers — then answers exactly as it answers somebody who never
// connected an account: nothing found, nothing logged, no error anywhere the
// person can see. The only thing that ends it is the person authorising again,
// so the state has to reach them.
//
// Deliberately NOT dismissible, the same rule as UnfiledEntriesBanner: this is
// a broken thing with one button, not a nudge toward an optional feature. It
// disappears the moment the connection works again.
//
// It shares `githubConnectionStatusQuery` with AutoTrackNag, so a dashboard
// load costs one call to GitHub between the two of them, and none at all for
// somebody with no account linked — that status is answered from our own
// tables. AutoTrackNag cannot carry this message itself: it is dismissed for
// good per org, and a person who waved it away a year ago is exactly the person
// this has to reach.
export function GithubReconnectBanner({ orgSlug }: { orgSlug: string }) {
	const heightTransition = useHeightTransition();
	const { data } = useQuery({
		...githubConnectionStatusQuery(orgSlug),
		staleTime: 5 * 60_000,
	});

	return (
		<AnimatePresence initial={false}>
			{data?.needsReconnect && (
				<motion.div
					key="github-reconnect"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={heightTransition}
					className="shrink-0 overflow-hidden"
				>
					{/* The gap under the banner is a PADDING on this inner shell, not a
					    margin on the animated box: a margin is not part of the height,
					    so the content below used to drop 16px in one frame on mount and
					    snap 16px back once the spring finished on unmount. */}
					<div className="pb-4">
						<div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
							<GithubLogoIcon className="size-4 shrink-0 text-destructive" />
							<div className="min-w-0 flex-1">
								<p className="text-base font-medium">
									Reconnect GitHub to keep logging your commits
								</p>
								<p className="text-sm text-muted-foreground">
									GitHub no longer accepts your connection, so your commits and
									pull requests are not reaching your time entries.
								</p>
							</div>
							<Button
								size="sm"
								nativeButton={false}
								render={
									<Link
										to="/$orgSlug/settings/integrations"
										params={{ orgSlug }}
									>
										Reconnect
									</Link>
								}
							/>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
