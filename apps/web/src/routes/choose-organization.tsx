import { matchesSearch } from "@farmer/core/lib/search";
import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useState } from "react";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { AuthHead, OrgMark } from "#/components/site/auth-parts.tsx";
import { authClient } from "#/lib/auth-client.ts";
import {
	isOrgPlaceholder,
	orgSlugOf,
	safeRedirectPath,
	withOrgSlug,
} from "#/lib/org-redirect.ts";
import { listMyOrganizations } from "#/server/organization.ts";

const searchSchema = z.object({
	// The page that was asked for, with its org segment still a placeholder (or
	// a slug the reader cannot open). The chosen slug replaces that segment.
	redirect: z.string().optional(),
});

/** Above this many workspaces the list gets a search box. */
const SEARCH_THRESHOLD = 3;

/**
 * The workspace chooser: where a link that names no workspace
 * (`/:org/settings`, see `lib/org-redirect.ts`) lands when the reader has more
 * than one.
 *
 * Outside `/$orgSlug` on purpose. There is no workspace yet, so there is no
 * sidebar to draw — the page is the sign-in frame, like the screen before it. A reader with exactly one workspace never sees it: the `/$orgSlug` guard
 * goes straight there, and so does this route when somebody opens it by hand.
 */
export const Route = createFileRoute("/choose-organization")({
	validateSearch: searchSchema,
	beforeLoad: async ({ search, location }) => {
		const mine = await listMyOrganizations();
		if (!mine) {
			throw redirect({ to: "/login", search: { redirect: location.href } });
		}
		const target = safeRedirectPath(search.redirect) ?? "/";
		const asked = orgSlugOf(target);
		const [only, ...others] = mine.organizations;
		if (!only)
			throw redirect({ to: "/no-access", search: { redirect: target } });
		// A link into a workspace the reader is in after all (opened by hand, or
		// joined since) needs no choice.
		if (mine.organizations.some((org) => org.slug === asked)) {
			throw redirect({ href: target });
		}
		// One workspace answers a placeholder, or a bare visit, without asking. A
		// real slug the reader cannot open still stops here, so the page can say
		// so — see the `/$orgSlug` guard.
		if (others.length === 0 && (!asked || isOrgPlaceholder(asked))) {
			throw redirect({ href: withOrgSlug(target, only.slug) });
		}
		return { mine, target };
	},
	loader: ({ context }) => ({ ...context.mine, target: context.target }),
	component: ChooseOrganizationPage,
});

function ChooseOrganizationPage() {
	const { email, organizations, target } = Route.useLoaderData();
	const navigate = useNavigate();
	const posthog = usePostHog();
	const [query, setQuery] = useState("");

	const askedSlug = orgSlugOf(target);
	// The page inside the workspace that the link points at, e.g.
	// "/settings/preferences". Empty when the link names only a workspace.
	const destination = target.replace(/^\/[^/?#]*/, "").replace(/[?#].*$/, "");
	const visible = organizations.filter((org) =>
		matchesSearch(query, [org.name, org.slug]),
	);

	const open = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
		// The fragment never reaches the server, so a link opened cold arrives
		// here with it on the chooser's own URL, not inside `target`: the
		// browser kept it across the guard's redirect. It goes back on here, at
		// the click, because only the browser can read it — and onto the
		// anchor too, so a new tab gets it as well.
		const withHash =
			href.includes("#") || !window.location.hash
				? href
				: `${href}${window.location.hash}`;
		event.currentTarget.href = withHash;
		// A modified click keeps the browser's own behaviour (a new tab).
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
			return;
		event.preventDefault();
		void navigate({ href: withHash });
	};

	const handleSignOut = async () => {
		await authClient.signOut();
		posthog.reset();
		// Back through sign-in to the same page, so a reader in the wrong account
		// can switch and still arrive where the link pointed.
		await navigate({ to: "/login", search: { redirect: target } });
	};

	return (
		<AuthSplitPanel>
			<AuthHead title="Which workspace do you want to open?">
				{askedSlug && !isOrgPlaceholder(askedSlug)
					? `You are not a member of "${askedSlug}", or it does not exist. Open one of your workspaces instead.`
					: destination
						? `The link opens "${destination}". You're a member of ${organizations.length} workspaces.`
						: `You're a member of ${organizations.length} workspaces.`}
			</AuthHead>

			<div className="fm-auth-list">
				{organizations.length > SEARCH_THRESHOLD ? (
					<label className="fm-auth-search">
						<MagnifyingGlassIcon size={16} aria-hidden />
						<input
							type="search"
							aria-label="Search workspaces"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Search workspaces"
						/>
					</label>
				) : null}
				{visible.length ? (
					// More than fit scrolls inside the list, so the card never grows
					// past the screen.
					<ul className="fm-auth-scroll">
						{visible.map((org) => {
							const href = withOrgSlug(target, org.slug);
							return (
								<li key={org.slug}>
									<a
										href={href}
										onClick={(event) => open(event, href)}
										onAuxClick={(event) => open(event, href)}
										className="fm-auth-ws"
									>
										<OrgMark name={org.name} logo={org.logo} />
										<span className="fm-auth-ws-text">
											<span className="fm-auth-ws-name">{org.name}</span>
											<span className="fm-auth-ws-meta">
												{org.slug} · {org.role}
											</span>
										</span>
										<CaretRightIcon
											size={14}
											aria-hidden
											className="fm-auth-caret"
										/>
									</a>
								</li>
							);
						})}
					</ul>
				) : (
					<div className="fm-auth-empty">No workspace matches "{query}".</div>
				)}
			</div>

			<div className="fm-auth-switch">
				<span className="fm-muted">Signed in as {email}.</span>
				<button type="button" className="fm-auth-link" onClick={handleSignOut}>
					Use a different account
				</button>
			</div>
		</AuthSplitPanel>
	);
}
