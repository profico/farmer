import { createClientInput } from "@farmer/core/schema";
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
import type { z } from "zod";

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
import { Page, PageHeader } from "#/components/ui/page-header.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { myAccessQuery } from "#/queries/access.ts";
import { allClientsQuery } from "#/queries/clients.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	archiveClient,
	createClient,
	unarchiveClient,
} from "#/server/clients.ts";

export const Route = createFileRoute("/$orgSlug/settings/clients")({
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

function ClientsPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const { data: clients } = useSuspenseQuery(allClientsQuery(orgSlug));
	const { data: access } = useSuspenseQuery(myAccessQuery(orgSlug));

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

	return (
		<Page>
			<PageHeader
				eyebrow={<SettingsEyebrow>Workspace</SettingsEyebrow>}
				title="Clients"
				lede={`Every project belongs to a client, which is what makes the Time report's "by client" view add up. The Internal client is created automatically and holds work that is never invoiced.`}
				action={access.canCreateProjects && <CreateClientDialog />}
			/>

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Client</TableHead>
						<TableHead>Kind</TableHead>
						<TableHead>Status</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{clients.map((client) => (
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
							<TableCell className="text-right">
								{/* The internal client is structural — archiving it would
									    strand every non-invoiced project. */}
								{access.canCreateProjects &&
									!client.isInternal &&
									(client.archivedAt ? (
										<Button
											variant="ghost"
											size="sm"
											disabled={busy}
											onClick={() => unarchive.mutate(client.id)}
										>
											Restore
										</Button>
									) : (
										<Button
											variant="ghost"
											size="sm"
											disabled={busy}
											onClick={() => archive.mutate(client.id)}
										>
											Archive
										</Button>
									))}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Page>
	);
}
