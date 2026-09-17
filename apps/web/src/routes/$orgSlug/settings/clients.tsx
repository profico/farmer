import { matchesSearch } from "@farmer/core/lib/search";
import { createClientInput, updateClientInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ArchivedSection } from "#/components/archived-section.tsx";
import { SettingsEyebrow } from "#/components/settings-nav.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import { PageFull, PageHeader } from "#/components/ui/page-header.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	TableScroll,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { searchFlag } from "#/lib/search-flag.ts";
import { myAccessQuery } from "#/queries/access.ts";
import { allClientsQuery } from "#/queries/clients.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	archiveClient,
	createClient,
	unarchiveClient,
	updateClient,
} from "#/server/clients.ts";

const searchSchema = z.object({
	archived: searchFlag,
});

const CLIENT_COLUMN_COUNT = 4;

export const Route = createFileRoute("/$orgSlug/settings/clients")({
	validateSearch: searchSchema,
	loader: async ({ context, params }) => {
		const orgSlug = params.orgSlug;
		await Promise.all([
			context.queryClient.ensureQueryData(allClientsQuery(orgSlug)),
			context.queryClient.ensureQueryData(myAccessQuery(orgSlug)),
		]);
	},
	component: ClientsPage,
});

function CreateClientDialog() {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof createClientInput>>({
		resolver: zodResolver(createClientInput),
		defaultValues: { name: "" },
	});

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof createClientInput>) =>
			createClient({ data }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).clients],
			});
			setOpen(false);
			form.reset({ name: "" });
		},
		onError: (error) => toast.error(error.message ?? "Could not create client"),
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button>+ New client</Button>} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New client</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Name</FormLabel>
									<FormControl>
										<Input autoFocus {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit" disabled={mutation.isPending}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

/** Rename one client.
 *
 *  A client name reaches the invoice and the Time report's "by client" view, so
 *  a typo in one is worth more than a cosmetic fix — and until now there was no
 *  way to correct it. `clientsService.update` and its server function had both
 *  existed since the aggregate was written with nothing calling them.
 *
 *  Offered for the internal client too: `isInternal` is a column, so nothing
 *  identifies that client by its name and every org spells the idea
 *  differently. Archiving it stays refused, which is the structural rule.
 */
function RenameClientDialog({
	client,
}: {
	client: { id: string; name: string };
}) {
	const orgSlug = useOrgSlug();
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof updateClientInput>>({
		resolver: zodResolver(updateClientInput),
		defaultValues: { clientId: client.id, name: client.name },
	});

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof updateClientInput>) =>
			updateClient({ data }),
		onSuccess: async () => {
			// Projects carry their client's name, and so do the report tabs grouped
			// by it — invalidate both families rather than just the list behind this
			// screen, or the old name survives everywhere it was already fetched.
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).clients],
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).projects],
				}),
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).reports],
				}),
			]);
			setOpen(false);
		},
		onError: (error) => toast.error(error.message ?? "Could not rename client"),
	});

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				// Re-seed from the row on every open: a cancelled edit must not be
				// what the field shows the next time somebody opens it.
				if (next) form.reset({ clientId: client.id, name: client.name });
			}}
		>
			<DialogTrigger
				render={
					<Button variant="outline" size="sm">
						Rename
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Rename client</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid grid-cols-[minmax(0,1fr)] gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel required>Name</FormLabel>
									<FormControl>
										<Input autoFocus {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<DialogFooter>
							<Button type="submit" disabled={mutation.isPending}>
								Save
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}

function ClientsPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: clients } = useSuspenseQuery(allClientsQuery(orgSlug));
	const { data: access } = useSuspenseQuery(myAccessQuery(orgSlug));
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).clients],
		});

	const archive = useMutation({
		mutationFn: (clientId: string) => archiveClient({ data: clientId }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not archive"),
	});
	const unarchive = useMutation({
		mutationFn: (clientId: string) => unarchiveClient({ data: clientId }),
		onSuccess: invalidate,
		onError: (error) => toast.error(error.message ?? "Could not restore"),
	});
	const busy = archive.isPending || unarchive.isPending;

	const [query, setQuery] = useState("");
	const searching = query.trim() !== "";
	const matching = clients.filter((c) => matchesSearch(query, [c.name]));
	const activeClients = matching.filter((c) => !c.archivedAt);
	const archivedClients = matching.filter((c) => c.archivedAt);
	// A search that only turns up archived rows opens their section rather than
	// reading as no result at all — the same rule as Projects.
	const archivedOpen =
		search.archived === "1" ||
		(searching && activeClients.length === 0 && archivedClients.length > 0);

	const renderClientRow = (client: (typeof clients)[number]) => (
		<TableRow key={client.id}>
			<TableCell className="font-medium">{client.name}</TableCell>
			<TableCell className="text-muted-foreground">
				{client.isInternal ? "Internal" : "External"}
			</TableCell>
			<TableCell>
				<StatusPill tone={client.archivedAt ? "neutral" : "positive"}>
					{client.archivedAt ? "Archived" : "Active"}
				</StatusPill>
			</TableCell>
			<TableCell>
				{/* Admin, not canCreateProjects: a PM may create a client to put a
					    new project under, but rename/archive/restore are admin-only
					    in clientsService, and a button that can only fail is worse
					    than no button. */}
				{access.isAdmin && (
					<div className="flex justify-end gap-2">
						<RenameClientDialog client={client} />
						{/* The internal client is structural — archiving it would
						    strand every non-invoiced project. */}
						{!client.isInternal &&
							(client.archivedAt ? (
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => unarchive.mutate(client.id)}
								>
									Restore
								</Button>
							) : (
								<Button
									variant="outline"
									size="sm"
									className="hover:text-destructive"
									disabled={busy}
									onClick={() => archive.mutate(client.id)}
								>
									Archive
								</Button>
							))}
					</div>
				)}
			</TableCell>
		</TableRow>
	);

	return (
		<PageFull>
			<PageHeader
				eyebrow={<SettingsEyebrow />}
				title="Clients"
				className="shrink-0"
				lede={`Every project belongs to a client, which is what makes the Time report's "by client" view add up. The Internal client is created automatically and holds work that is never invoiced.`}
				action={
					<div className="flex items-center gap-2">
						<SearchInput
							value={query}
							onValueChange={setQuery}
							placeholder="Search clients…"
							className="flex-1 sm:w-56 sm:flex-none"
						/>
						{access.canCreateProjects && <CreateClientDialog />}
					</div>
				}
			/>

			<TableScroll>
				<Table bleed={false} stickyHeader containerClassName="border-b">
					<TableHeader>
						<TableRow>
							<TableHead>Client</TableHead>
							<TableHead>Kind</TableHead>
							<TableHead>Status</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{searching && activeClients.length === 0 && (
							<NoMatchesRow colSpan={CLIENT_COLUMN_COUNT}>
								{archivedClients.length > 0
									? "Only archived clients match your search."
									: "No clients match your search."}
							</NoMatchesRow>
						)}
						{activeClients.map(renderClientRow)}
						<ArchivedSection
							count={archivedClients.length}
							colSpan={CLIENT_COLUMN_COUNT}
							open={archivedOpen}
							sticky
							onOpenChange={(open) =>
								navigate({ search: { archived: open ? "1" : undefined } })
							}
						>
							{archivedClients.map(renderClientRow)}
						</ArchivedSection>
					</TableBody>
				</Table>
			</TableScroll>
		</PageFull>
	);
}
