import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { toast } from "sonner";
import { CreateEntryTypeDialog } from "#/components/create-entry-type-dialog.tsx";
import { StatusPill } from "#/components/status-pill.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Section } from "#/components/ui/section.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { resolveCategoryColor } from "#/lib/category-colors.ts";
import { cn } from "#/lib/utils.ts";
import { managedEntryTypesQuery } from "#/queries/entry-types.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { requireOrgAdmin } from "#/server/auth.ts";
import { archiveEntryType } from "#/server/entry-types.ts";

export const Route = createFileRoute("/$orgSlug/settings/entry-types")({
	beforeLoad: async () => {
		await requireOrgAdmin();
	},
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(managedEntryTypesQuery()),
			context.queryClient.ensureQueryData(projectsQuery()),
		]);
	},
	component: EntryTypesSettingsPage,
});

type ManagedEntryType = {
	id: string;
	name: string;
	color: string | null;
	description: string | null;
	billableDefault: boolean;
	blockCount: number;
	archivedAt: Date | null;
	scope: "site" | "organization" | "project";
	projectId: string | null;
};

function EntryTypesSettingsPage() {
	const { data: types } = useSuspenseQuery(managedEntryTypesQuery());
	const { data: projects } = useSuspenseQuery(projectsQuery());
	const queryClient = useQueryClient();

	const siteTypes = types.filter((t) => t.scope === "site");
	const orgTypes = types.filter((t) => t.scope === "organization");
	const projectTypes = types.filter((t) => t.scope === "project");

	const archiveMutation = useMutation({
		mutationFn: (entryTypeId: string) =>
			archiveEntryType({ data: entryTypeId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: managedEntryTypesQuery().queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not archive entry type");
		},
	});

	return (
		<div className="page-shell">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
				<div>
					<h1 className="font-display text-xl">Entry types</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						How time is categorized across the org.
					</p>
				</div>
				<CreateEntryTypeDialog
					scope="organization"
					triggerLabel="+ New organization type"
				/>
			</div>

			<div className="-mx-4 mt-8 sm:-mx-8">
				<Section
					title="Site defaults"
					description="Built-in types available to every organization on the platform."
				>
					<div className="flex flex-wrap gap-2">
						{siteTypes.map((t) => {
							const category = resolveCategoryColor(t.color);
							return (
								<Badge key={t.id} variant="outline">
									<span
										className="mr-1 size-2 rounded-full"
										style={{ backgroundColor: category.dot }}
									/>
									{t.name}
								</Badge>
							);
						})}
					</div>
				</Section>

				<Section title="Organization types">
					<EntryTypeTable
						types={orgTypes}
						onArchive={(id) => archiveMutation.mutate(id)}
					/>
				</Section>

				<Section title="Project types">
					<div className="space-y-6">
						{projects.map((project) => {
							const projTypes = projectTypes.filter(
								(t) => t.projectId === project.id,
							);
							return (
								<div key={project.id} className="space-y-3">
									<div className="flex items-center justify-between">
										<h3 className="font-display text-xl">{project.name}</h3>
										<CreateEntryTypeDialog
											scope="project"
											projectId={project.id}
											triggerLabel="+ New project type"
										/>
									</div>
									<EntryTypeTable
										types={projTypes}
										onArchive={(id) => archiveMutation.mutate(id)}
									/>
								</div>
							);
						})}
					</div>
				</Section>
			</div>
		</div>
	);
}

function EntryTypeTable({
	types,
	onArchive,
}: {
	types: ManagedEntryType[];
	onArchive: (id: string) => void;
}) {
	if (types.length === 0) {
		return <p className="text-sm text-muted-foreground">None yet.</p>;
	}
	return (
		<Table
			className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
			containerClassName="-mx-4 border-b sm:-mx-8"
		>
			<TableHeader>
				<TableRow>
					<TableHead className="w-full">Name</TableHead>
					<TableHead>Billing</TableHead>
					<TableHead>Blocks</TableHead>
					<TableHead>Status</TableHead>
					<TableHead className="text-right" />
				</TableRow>
			</TableHeader>
			<TableBody>
				{types.map((t) => {
					const category = resolveCategoryColor(t.color);
					const archived = !!t.archivedAt;
					return (
						<TableRow key={t.id} className={cn(archived && "opacity-60")}>
							<TableCell className="font-medium">
								<span className="flex items-start gap-2">
									<span
										className="mt-1.5 size-2 shrink-0 rounded-full"
										style={{ backgroundColor: category.dot }}
									/>
									<span>
										<span className="block">{t.name}</span>
										{t.description && (
											<span className="block text-xs font-normal text-muted-foreground">
												{t.description}
											</span>
										)}
									</span>
								</span>
							</TableCell>
							<TableCell>
								<StatusPill tone={t.billableDefault ? "positive" : "neutral"}>
									{t.billableDefault ? "Billable" : "Non-billable"}
								</StatusPill>
							</TableCell>
							<TableCell>
								<span className="font-display text-[15px]">{t.blockCount}</span>
							</TableCell>
							<TableCell>
								<StatusPill tone={archived ? "neutral" : "positive"}>
									{archived ? "Archived" : "Active"}
								</StatusPill>
							</TableCell>
							<TableCell className="text-right">
								{!archived && (
									<Button
										variant="ghost"
										size="sm"
										onClick={() => onArchive(t.id)}
									>
										<Archive />
										Archive
									</Button>
								)}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
