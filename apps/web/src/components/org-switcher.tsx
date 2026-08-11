import { slugify } from "@farmer/core/lib/slug";
import { CaretUpDownIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
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
import { getInitials } from "#/lib/utils.ts";

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
	const { data: organizations, refetch: refetchOrganizations } =
		authClient.useListOrganizations();
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
		// The atom-listener refetch this triggers races the navigate() below —
		// await it explicitly so the new org is in the list by the time we land.
		await refetchOrganizations();
		await navigate({ to: "/$orgSlug", params: { orgSlug: data.slug } });
	};

	// The mark + name, identical in both modes — only what wraps it changes.
	const brand = (
		<>
			{organizationLogo ? (
				<img
					src={organizationLogo}
					alt=""
					className="size-6.5 shrink-0 rounded-md object-contain"
				/>
			) : (
				<span className="flex size-6.5 shrink-0 items-center justify-center rounded-md bg-primary text-[11.5px] font-medium text-primary-foreground">
					{getInitials(organizationName)}
				</span>
			)}
			<span className="min-w-0 flex-1 truncate text-base font-medium">
				{organizationName}
			</span>
		</>
	);

	if (singleOrg) {
		// A label, not a disabled button: a control that can never do anything
		// shouldn't offer a hover state or take focus.
		return (
			<div className="flex h-auto w-full items-center gap-2.5 rounded-2xl p-2 text-left">
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
							className="h-auto w-full justify-start gap-2.5 rounded-2xl border-transparent bg-transparent p-2 text-left hover:border-transparent hover:bg-muted"
						>
							{brand}
							<CaretUpDownIcon
								weight="regular"
								className="size-3.5 shrink-0 text-muted-foreground"
							/>
						</Button>
					}
				/>
				<DropdownMenuContent align="start" className="w-56">
					{organizations?.map((org) => (
						<DropdownMenuItem
							key={org.id}
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
