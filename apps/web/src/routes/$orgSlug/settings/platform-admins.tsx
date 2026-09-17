import { ShieldCheckIcon } from "@phosphor-icons/react";
import {
	useMutation,
	useQuery,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Page, PageHeader, PageSection } from "#/components/ui/page-header.tsx";
import { SearchInput } from "#/components/ui/search-input.tsx";
import { getInitials } from "#/lib/utils.ts";
import { platformKeys } from "#/queries/keys.ts";
import {
	platformAdminsQuery,
	platformPeopleSearchQuery,
} from "#/queries/platform-admins.ts";
import { setPlatformAdmin } from "#/server/platform-admins.ts";

/**
 * Who operates this deployment.
 *
 * **A settings page like every other one, under an Infrastructure group.** The
 * data is the instance's rather than the workspace's — `user.role`, one value
 * per person for the whole deployment — but that is a fact about the data, not
 * a reason to give it its own chrome: somebody looking for it goes to Settings,
 * and a page that leaves the sidebar behind reads as having left the app.
 * `settings-nav.tsx` carries it as a third group beside Account and Workspace,
 * shown only to a platform admin.
 *
 * **The list is the admins, and everybody else is behind a search.** A
 * multi-tenant instance's `user` table is every customer's staff directory, so
 * rendering it to fill in a promote screen turns one grant into a readable
 * roster of every person on the deployment. The search answers a name somebody
 * already has; it refuses a query under two characters, server-side as well as
 * here, so an empty box cannot be made to mean "everybody".
 *
 * The role carries impersonation, which is why the copy says so plainly rather
 * than calling it access. See `docs/domains/authentication.md`.
 */
export const Route = createFileRoute("/$orgSlug/settings/platform-admins")({
	beforeLoad: ({ context, params }) => {
		// Read off the parent layout's context rather than a server call: it is
		// already resolved for this request, and the real refusal is
		// `platformAdminMiddleware` on every server function below.
		if (!context.isPlatformAdmin) {
			throw redirect({
				to: "/$orgSlug/settings",
				params: { orgSlug: params.orgSlug },
			});
		}
	},
	loader: async ({ context }) => {
		await context.queryClient.ensureQueryData(platformAdminsQuery());
	},
	component: PlatformAdminsPage,
});

/**
 * A person's face and name, off the `user` row itself.
 *
 * Deliberately not `PersonCell`: that one resolves a photo through the org
 * directory, and these people are the instance's accounts rather than this
 * workspace's roster — an admin of another organization has no directory row
 * here. `user.image` is the photo anyway.
 */
function PlatformPersonCell({
	person,
}: {
	person: { id: string; name: string; email: string; image: string | null };
}) {
	return (
		<span className="flex min-w-0 items-center gap-2.5">
			<Avatar size="sm">
				{person.image && (
					// Same reason as `PersonAvatar`: Google answers 403 to a request
					// for a profile photo that carries an unexpected referrer.
					<AvatarImage src={person.image} alt="" referrerPolicy="no-referrer" />
				)}
				<AvatarFallback>{getInitials(person.name)}</AvatarFallback>
			</Avatar>
			<span className="min-w-0">
				<span className="block truncate font-medium">{person.name}</span>
				<span className="block truncate text-xs text-muted-foreground">
					{person.email}
				</span>
			</span>
		</span>
	);
}

function PlatformAdminsPage() {
	const queryClient = useQueryClient();
	const { session } = Route.useRouteContext();
	const { data: admins } = useSuspenseQuery(platformAdminsQuery());

	const [term, setTerm] = useState("");
	const { data: results = [], isFetching } = useQuery(
		platformPeopleSearchQuery(term),
	);

	const change = useMutation({
		mutationFn: (input: { userId: string; isPlatformAdmin: boolean }) =>
			setPlatformAdmin({ data: input }),
		onSuccess: async (_person, input) => {
			// Both families: the admin list gained or lost a row, and every cached
			// search result carries the flag that decides which button it shows.
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: platformKeys.admins }),
				queryClient.invalidateQueries({ queryKey: platformKeys.people }),
			]);
			toast.success(
				input.isPlatformAdmin
					? "They now operate this deployment."
					: "They no longer operate this deployment.",
			);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	const busy = change.isPending;

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Platform admins"
				lede="These people operate this deployment of Farmer. They have full access to the platform and can manage everyone and everything."
			/>

			<PageSection title="Current">
				<ul className="divide-y divide-border">
					{admins.map((person) => (
						<li
							key={person.id}
							className="flex items-center gap-3 py-3 first:pt-0"
						>
							<PlatformPersonCell person={person} />
							<span className="flex-1" />
							{person.id === session.user.id ? (
								<span className="text-xs text-muted-foreground">You</span>
							) : (
								<Button
									variant="outline"
									size="sm"
									className="hover:text-destructive"
									disabled={busy}
									onClick={() =>
										change.mutate({
											userId: person.id,
											isPlatformAdmin: false,
										})
									}
								>
									Remove
								</Button>
							)}
						</li>
					))}
				</ul>
			</PageSection>

			<PageSection
				title="Add somebody"
				description="Search by name or email address. Nobody is listed until you search."
			>
				<SearchInput
					value={term}
					onValueChange={setTerm}
					placeholder="Name or email address…"
					className="max-w-sm"
				/>

				{term.trim().length >= 2 && (
					<ul className="mt-4 divide-y divide-border">
						{results.map((person) => (
							<li key={person.id} className="flex items-center gap-3 py-3">
								<PlatformPersonCell person={person} />
								<span className="flex-1" />
								<Button
									size="sm"
									disabled={busy}
									onClick={() =>
										change.mutate({
											userId: person.id,
											isPlatformAdmin: true,
										})
									}
								>
									<ShieldCheckIcon />
									Make platform admin
								</Button>
							</li>
						))}
						{results.length === 0 && (
							<li className="py-3 text-sm text-muted-foreground">
								{isFetching
									? "Searching…"
									: "Nobody matches, or everybody who does is already a platform admin."}
							</li>
						)}
					</ul>
				)}
			</PageSection>
		</Page>
	);
}
