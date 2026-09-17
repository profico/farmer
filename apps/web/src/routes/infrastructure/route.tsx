import { isPlatformAdminRole } from "@farmer/core/lib/platform-admin";
import { ArrowLeftIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useRouterState,
} from "@tanstack/react-router";

import { cn } from "#/lib/utils.ts";
import { getSession } from "#/server/auth.ts";
import { getDefaultOrgSlugForSession } from "#/server/organization.ts";

/**
 * Infrastructure — the deployment's own settings, as opposed to a workspace's.
 *
 * **A route tree of its own, outside `/$orgSlug`, and that is the point.** All
 * fourteen settings pages live under `$orgSlug/settings/` and take their
 * organization from the path; everything here belongs to the INSTANCE and
 * would have to pick an arbitrary workspace to be addressable under one. A
 * platform admin need not even be a member of the organization they happen to
 * be looking at when they come here.
 *
 * It is the shell issue #75 asks for. Today it holds one entry — who operates
 * the deployment. Email, S3, the OAuth sources and the rest arrive as further
 * entries in `ENTRIES` below once the secret encryption in that issue lands,
 * and none of them needs this file to change shape.
 *
 * **Not in the sidebar.** `NavItem.to` is typed `OrgRoutePath` and every
 * surface that draws one passes `params={{ orgSlug }}`, so a destination with
 * no organization cannot ride in that list without widening the type through
 * the sidebar, the tab bar and the settings hub. The way in is the Instance
 * section on the settings hub, which is where somebody looking for it goes.
 */

type Entry = {
	to: "/infrastructure/admins";
	label: string;
	description: string;
	icon: typeof ShieldCheckIcon;
};

const ENTRIES: Entry[] = [
	{
		to: "/infrastructure/admins",
		label: "Platform admins",
		description: "Who operates this deployment.",
		icon: ShieldCheckIcon,
	},
];

export const Route = createFileRoute("/infrastructure")({
	beforeLoad: async () => {
		const session = await getSession();
		if (!session) throw redirect({ to: "/login" });
		// The same refusal for "not signed in" and "signed in as somebody who does
		// not operate this deployment" would be wrong here: the second is a real
		// person with a real workspace, and `/` resolves where they belong.
		if (!isPlatformAdminRole(session.user.role)) throw redirect({ to: "/" });
		return { session };
	},
	loader: async () => ({
		// Where "Back to Farmer" goes. Resolved rather than remembered: this tree
		// is reachable from any workspace, and a platform admin may hold several.
		orgSlug: await getDefaultOrgSlugForSession().catch(() => null),
	}),
	component: InfrastructureLayout,
});

function InfrastructureLayout() {
	const { orgSlug } = Route.useLoaderData();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12 md:flex-row md:gap-10">
			<aside className="md:w-56 md:shrink-0">
				{orgSlug ? (
					<Link
						to="/$orgSlug"
						params={{ orgSlug }}
						className="-ml-1 flex w-fit items-center gap-1.5 py-1 pl-1 text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
					>
						<ArrowLeftIcon weight="bold" className="size-3.5" />
						Back to Farmer
					</Link>
				) : (
					<Link
						to="/"
						className="-ml-1 flex w-fit items-center gap-1.5 py-1 pl-1 text-sm text-muted-foreground transition-colors duration-(--dur-fast) hover:text-foreground"
					>
						<ArrowLeftIcon weight="bold" className="size-3.5" />
						Back to Farmer
					</Link>
				)}

				<p className="eyebrow mt-6 mb-2">Infrastructure</p>
				<nav className="flex flex-col gap-0.5">
					{ENTRIES.map((entry) => (
						<Link
							key={entry.to}
							to={entry.to}
							className={cn(
								"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-(--dur-fast)",
								pathname === entry.to
									? "bg-muted font-medium text-foreground"
									: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
							)}
						>
							<entry.icon className="size-4 shrink-0" />
							{entry.label}
						</Link>
					))}
				</nav>
			</aside>

			<main className="screen min-w-0 flex-1">
				<Outlet />
			</main>
		</div>
	);
}
