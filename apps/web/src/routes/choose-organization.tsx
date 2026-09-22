import { matchesSearch } from "@farmer/core/lib/search";
import { CaretRightIcon } from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useState } from "react";
import { z } from "zod";

import { Field } from "#/components/field.tsx";
import { PageFull } from "#/components/ui/page-header.tsx";
import { SearchInput } from "#/components/ui/search-input.tsx";
import { authClient } from "#/lib/auth-client.ts";
import {
	isOrgPlaceholder,
	orgSlugOf,
	safeRedirectPath,
	withOrgSlug,
} from "#/lib/org-redirect.ts";
import { cn, getInitials } from "#/lib/utils.ts";
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
 * sidebar to draw — the page is the app's frame and ground with one island in
 * it. A reader with exactly one workspace never sees it: the `/$orgSlug` guard
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
		const [only, ...others] = mine.organizations;
		if (!only) throw redirect({ to: "/no-access" });
		if (others.length === 0) {
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
		// A modified click keeps the browser's own behaviour (a new tab).
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
			return;
		event.preventDefault();
		void navigate({ href });
	};

	const handleSignOut = async () => {
		await authClient.signOut();
		posthog.reset();
		// Back through sign-in to the same page, so a reader in the wrong account
		// can switch and still arrive where the link pointed.
		await navigate({ to: "/login", search: { redirect: target } });
	};

	return (
		<>
			<Field timezone={organizations[0]?.timezone ?? "UTC"} />
			<div className="app-frame">
				{/* A small centred block in the one island, like a sign-in screen:
				    the choice is the whole page, so it sits where the eye lands. */}
				<PageFull className="items-center justify-center">
					<div className="w-full max-w-xl text-center">
						<h1 className="h1">Choose a workspace</h1>
						<p className="lede mx-auto mt-2 max-w-[48ch]">
							{askedSlug && !isOrgPlaceholder(askedSlug)
								? `You are not a member of "${askedSlug}", or it does not exist. Open one of your workspaces instead.`
								: destination
									? `The link is taking you to "${destination}", which workspace do you want to open this in?`
									: "Which workspace do you want to open?"}
						</p>

						{organizations.length > SEARCH_THRESHOLD ? (
							<SearchInput
								value={query}
								onValueChange={setQuery}
								placeholder="Search workspaces…"
								className="mt-6"
							/>
						) : null}

						{visible.length ? (
							// Two columns and three rows at most; more scrolls inside the
							// list, so the page never grows past the island. The padding
							// keeps a tile's focus ring clear of the scroll edge.
							<ul className="-mx-1 mt-4 grid max-h-[13.5rem] gap-2 overflow-y-auto p-1 text-left sm:grid-cols-2">
								{visible.map((org) => {
									const href = withOrgSlug(target, org.slug);
									return (
										<li key={org.slug}>
											<a
												href={href}
												onClick={(event) => open(event, href)}
												className="group/row flex h-16 items-center gap-3 rounded-lg border px-3 transition-colors duration-(--dur-fast) outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
											>
												<OrgMark name={org.name} logo={org.logo} />
												<span className="min-w-0 flex-1">
													<span className="block truncate text-sm font-medium">
														{org.name}
													</span>
													<span className="block truncate text-xs text-muted-foreground">
														{org.slug} · {org.role}
													</span>
												</span>
												<CaretRightIcon
													weight="regular"
													aria-hidden
													className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity duration-(--dur-fast) group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
												/>
											</a>
										</li>
									);
								})}
							</ul>
						) : (
							<p className="mt-4 text-sm text-muted-foreground">
								No workspace matches "{query}".
							</p>
						)}

						<p className="mt-6 text-sm text-muted-foreground">
							Signed in as {email}.{" "}
							<button
								type="button"
								className="underline-offset-4 hover:text-foreground hover:underline"
								onClick={handleSignOut}
							>
								Use a different account
							</button>
						</p>
					</div>
				</PageFull>
			</div>
		</>
	);
}

/** The workspace's logo, or its initials — the same mark the sidebar draws. */
function OrgMark({ name, logo }: { name: string; logo: string | null }) {
	const size = "size-9";
	return logo ? (
		<img
			src={logo}
			alt=""
			className={cn("shrink-0 rounded-md object-contain", size)}
		/>
	) : (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground",
				size,
			)}
		>
			{getInitials(name)}
		</span>
	);
}
