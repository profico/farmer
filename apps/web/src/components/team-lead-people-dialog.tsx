import { matchesSearch } from "@farmer/core/lib/search";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useState } from "react";
import { toast } from "sonner";

import { PersonCell } from "#/components/person-avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import { SearchInput } from "#/components/ui/search-input.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { queryKeys } from "#/queries/keys.ts";
import { teamLeadPeopleQuery } from "#/queries/team-leads.ts";
import { setTeamLeadPeople } from "#/server/team-leads.ts";

type Candidate = {
	userId: string;
	name: string;
	email: string;
	archivedAt: Date | null;
};

/**
 * Who a Team Lead leads — edited by an Admin, from the Members page.
 *
 * The list IS the role: someone with people on it sees everything about them
 * (their time on every project, Tracking, time off) and, on any project where
 * their OWN assignment is Team Lead, holds it as a PM. A plain Member
 * assignment stays a Member — the list does not widen that. So this is the
 * one place that decides who is a Team Lead, and it is deliberately not on
 * the lead's own screen.
 */
export function TeamLeadPeopleDialog({
	lead,
	people,
	trigger,
}: {
	lead: { userId: string; name: string };
	/** Everyone in the org; archived people and the lead are left out here. */
	people: Candidate[];
	trigger: ReactElement;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState<Set<string> | null>(null);

	const current = useQuery({
		...teamLeadPeopleQuery(orgSlug, lead.userId),
		enabled: open,
	});

	// Local edits start from the saved list once it arrives; until then the
	// boxes reflect the server and nothing can be ticked into a stale state.
	const picked = selected ?? new Set((current.data ?? []).map((p) => p.userId));

	const candidates = people
		.filter((p) => p.userId !== lead.userId && p.archivedAt == null)
		.filter((p) => matchesSearch(query, [p.name, p.email]));

	const toggle = (userId: string) => {
		setSelected(() => {
			const next = new Set(picked);

			if (next.has(userId)) next.delete(userId);
			else next.add(userId);

			return next;
		});
	};

	const mutation = useMutation({
		mutationFn: () =>
			setTeamLeadPeople({
				data: { leadUserId: lead.userId, personUserIds: [...picked] },
			}),
		onSuccess: async () => {
			// The list changes what the lead may see everywhere, so every
			// people-scoped cache goes with it.
			await Promise.all(
				[
					queryKeys(orgSlug).members,
					queryKeys(orgSlug).access,
					queryKeys(orgSlug).reports,
					queryKeys(orgSlug).compliance,
					queryKeys(orgSlug).projects,
				].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
			);
			toast.success(`Saved ${lead.name}'s people`);
			setOpen(false);
		},
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);

				if (!next) {
					setSelected(null);
					setQuery("");
				}
			}}
		>
			<DialogTrigger render={trigger} />
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{lead.name}'s people</DialogTitle>
					<DialogDescription>
						{lead.name} sees everything about the people ticked here — their
						time on every project, their Tracking status, their time off — and
						runs any project where they hold a Team Lead assignment as a PM. A
						plain Member assignment stays a Member. A person can be on several
						leads' lists.
					</DialogDescription>
				</DialogHeader>
				<SearchInput
					value={query}
					onValueChange={setQuery}
					placeholder="Search people…"
				/>
				<div className="scrollbar-stable -mx-6 max-h-80 divide-y divide-line2 overflow-y-auto border-y border-line2">
					{candidates.length === 0 && (
						<p className="px-6 py-6 text-center text-sm text-muted-foreground">
							Nobody matches your search.
						</p>
					)}
					{candidates.map((p) => (
						<label
							key={p.userId}
							className="flex cursor-pointer items-center gap-3 px-6 py-2 hover:bg-muted"
						>
							<input
								type="checkbox"
								className="accent-primary"
								checked={picked.has(p.userId)}
								onChange={() => toggle(p.userId)}
								disabled={current.isPending}
							/>
							<PersonCell userId={p.userId} name={p.name}>
								<span className="block text-xs text-muted-foreground">
									{p.email}
								</span>
							</PersonCell>
						</label>
					))}
				</div>
				<DialogFooter>
					<span className="mr-auto self-center text-sm text-muted-foreground">
						{picked.size === 0
							? "Nobody — not a Team Lead"
							: `${picked.size} ${picked.size === 1 ? "person" : "people"}`}
					</span>
					<Button
						onClick={() => mutation.mutate()}
						disabled={mutation.isPending || current.isPending}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
