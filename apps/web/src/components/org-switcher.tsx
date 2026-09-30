import { slugify } from "@farmer/core/lib/slug";
import { CaretUpDownIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { cn, getInitials } from "#/lib/utils.ts";
import { myOrganizationsQuery } from "#/queries/organization.ts";

export function OrgSwitcher({
	orgSlug,
	organizationName,
	organizationLogo,
	singleOrg = false,
}: {
	orgSlug: string;
	organizationName: string;
	organizationLogo?: string | null;
	/**
	 * Single-org mode: there is nothing to switch to and nothing to create, so
	 * the control collapses to the brand row it was already drawing. Cosmetic
	 * only — `allowUserToCreateOrganization` in the auth config is what actually
	 * closes the endpoint.
	 */
	singleOrg?: boolean;
}) {
	const navigate = useNavigate();
	const { data: organizations, refetch: refetchOrganizations } = useQuery(
		myOrganizationsQuery(orgSlug),
	);
	const [createOpen, setCreateOpen] = useState(false);
	const [name, setName] = useState("");
	const [submitting, setSubmitting] = useState(false);

	const handleCreate = async () => {
		if (!name.trim()) return;
		setSubmitting(true);
		const slug = slugify(name);
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		const { data, error } = await authClient.organization.create({
			name,
			slug,
			timezone,
			country: "US",
		});
		setSubmitting(false);
		if (error) {
			toast.error(error.message ?? "Could not create organization");
			return;
		}
		setCreateOpen(false);
		setName("");
		// Refetch before the navigate() below, so the new org is in the list by
		// the time we land.
		await refetchOrganizations();
		await navigate({ to: "/$orgSlug", params: { orgSlug: data.slug } });
	};

	// The mark alone, at the size each frame wants it.
	const mark = (size: string) =>
		organizationLogo ? (
			<img
				src={organizationLogo}
				alt=""
				className={cn("shrink-0 rounded-md object-contain", size)}
			/>
		) : (
			<span
				className={cn(
					"flex shrink-0 items-center justify-center rounded-md bg-primary text-[11.5px] font-medium text-primary-foreground",
					size,
				)}
			>
				{getInitials(organizationName)}
			</span>
		);

	// The mark, then the name and the caret in a `.nav-label` band — the same
	// out-of-flow, fixed-width, CSS-driven idiom every other row in the column
	// uses. It is ONE tree at both widths, on purpose: this used to be two
	// different subtrees chosen by a `compact` prop, so React swapped them in the
	// single frame `collapsed` flipped and the name appeared and vanished with no
	// fade at all, beside a column taking 340ms to close. Nothing here reads a
	// width — `.nav-brand` and `.nav-label` in styles.css do, off the same two
	// attributes as the column, so the fade and the box start on one frame.
	const brand = (
		<>
			{mark("size-6.5")}
			<span className="nav-label nav-label-brand">
				<span className="min-w-0 flex-1 truncate text-base font-medium">
					{organizationName}
				</span>
				{!singleOrg && (
					<CaretUpDownIcon
						weight="regular"
						className="size-3.5 shrink-0 text-muted-foreground"
					/>
				)}
			</span>
		</>
	);

	if (singleOrg) {
		// A label, not a disabled button: a control that can never do anything
		// shouldn't offer a hover state or take focus. The `title` is how the name
		// stays reachable once the column is a rail.
		return (
			<div
				title={organizationName}
				className="nav-brand flex items-center gap-2.5 p-1.5 text-left"
			>
				{brand}
			</div>
		);
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="outline"
							title={organizationName}
							aria-label={`Workspace: ${organizationName}`}
							// `h-auto` because `Button`'s own `h-8` is 7.8px shorter than the
							// padding and mark here add up to, and the whole nav under the
							// header stepped by that much whenever the height changed.
							//
							// No `w-full` and no `rounded-*`: `.nav-brand` owns both, and a
							// utility would win the cascade against it.
							className="nav-brand h-auto justify-start gap-2.5 border-transparent bg-transparent p-1.5 text-left hover:border-transparent hover:bg-muted"
						>
							{brand}
						</Button>
					}
				/>
				<DropdownMenuContent align="start" className="w-56">
					{organizations?.map((org) => (
						<DropdownMenuItem
							key={org.slug}
							onClick={() =>
								navigate({
									to: "/$orgSlug",
									params: { orgSlug: org.slug },
								})
							}
						>
							{org.slug === orgSlug && (
								<CheckIcon weight="regular" className="size-4" />
							)}
							<span className={org.slug === orgSlug ? "" : "ml-6"}>
								{org.name}
							</span>
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => setCreateOpen(true)}>
						<PlusIcon weight="regular" className="size-4" />
						New organization
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create organization</DialogTitle>
					</DialogHeader>
					<div className="grid gap-2">
						<Label htmlFor="org-name">Name</Label>
						<Input
							id="org-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							autoFocus
						/>
					</div>
					<DialogFooter>
						<Button onClick={handleCreate} disabled={submitting}>
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
