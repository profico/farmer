import {
	LockIcon,
	MagnifyingGlassIcon,
	PlugIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	availableGithubReposQuery,
	githubConnectionStatusQuery,
	projectGithubReposQuery,
} from "#/queries/github.ts";
import {
	linkProjectGithubRepo,
	unlinkProjectGithubRepo,
} from "#/server/github.ts";

export function ManageProjectGithubReposDialog({
	projectId,
	orgSlug,
	onOpenChange,
}: {
	projectId: string | null;
	orgSlug: string;
	onOpenChange: (open: boolean) => void;
}) {
	const open = projectId !== null;
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");

	// The dialog is kept mounted across projects (it's driven by `projectId`), so
	// a query typed for one project would still be filtering the next one's list.
	useEffect(() => {
		if (!open) setSearch("");
	}, [open]);

	const { data: status } = useQuery({
		...githubConnectionStatusQuery(orgSlug),
		enabled: open,
	});
	const { data: linkedRepos } = useQuery({
		...projectGithubReposQuery(orgSlug, projectId ?? ""),
		enabled: open && !!projectId,
	});
	const { data: availableRepos } = useQuery({
		...availableGithubReposQuery(orgSlug),
		enabled: open && !!projectId && !!status?.connected,
	});

	const linkMutation = useMutation({
		mutationFn: (repo: { githubRepoId: number; installationId: number }) =>
			linkProjectGithubRepo({
				data: {
					projectId: projectId ?? "",
					githubRepoId: repo.githubRepoId,
					installationId: repo.installationId,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectGithubReposQuery(orgSlug, projectId ?? "").queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not link repository");
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: (projectGithubRepoId: string) =>
			unlinkProjectGithubRepo({ data: projectGithubRepoId }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectGithubReposQuery(orgSlug, projectId ?? "").queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not unlink repository");
		},
	});

	const linkedGithubRepoIds = new Set(
		linkedRepos?.map((r) => r.githubRepoId) ?? [],
	);
	const query = search.trim().toLowerCase();
	const unlinkedRepos = (availableRepos ?? []).filter(
		(r) => !linkedGithubRepoIds.has(r.githubRepoId),
	);
	// Search spans both lists: an installation can expose hundreds of repos, and
	// "is this one already linked?" is the same question as "where is it?".
	const linkableRepos = query
		? unlinkedRepos.filter((r) => r.fullName.toLowerCase().includes(query))
		: unlinkedRepos;
	const visibleLinkedRepos = query
		? (linkedRepos ?? []).filter((r) =>
				r.fullName.toLowerCase().includes(query),
			)
		: (linkedRepos ?? []);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Manage GitHub repos</DialogTitle>
				</DialogHeader>

				{status && !status.connected ? (
					<div className="flex flex-col items-center gap-3 py-6 text-center">
						<PlugIcon className="size-6 text-muted-foreground" />
						<p className="text-sm text-muted-foreground">
							Connect your GitHub account to link repositories to this project.
						</p>
						<Button
							variant="outline"
							nativeButton={false}
							render={
								<Link to="/$orgSlug/settings/integrations" params={{ orgSlug }}>
									Go to Integrations
								</Link>
							}
						/>
					</div>
				) : (
					<div className="grid min-w-0 gap-4">
						<div className="relative">
							<MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
							<Input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search repositories…"
								className="w-full pl-8"
							/>
						</div>

						<div className="min-w-0">
							<p className="eyebrow mb-2">Linked repositories</p>
							{visibleLinkedRepos.length > 0 ? (
								<div className="scrollbar-stable max-h-[min(14rem,25dvh)] overflow-y-auto rounded-md border">
									{visibleLinkedRepos.map((repo) => (
										<div
											key={repo.id}
											className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
										>
											<span className="flex min-w-0 items-center gap-1.5 text-sm">
												<span className="truncate">{repo.fullName}</span>
												{repo.private && (
													<Badge variant="outline" className="shrink-0 gap-1">
														<LockIcon className="size-3" />
														Private
													</Badge>
												)}
											</span>
											<Button
												variant="ghost"
												size="icon-xs"
												className="shrink-0"
												onClick={() => unlinkMutation.mutate(repo.id)}
												disabled={unlinkMutation.isPending}
											>
												<XIcon weight="regular" className="size-3" />
												<span className="sr-only">Unlink</span>
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									{query
										? "No linked repositories match your search."
										: "No repositories linked yet."}
								</p>
							)}
						</div>

						<div className="min-w-0">
							<p className="eyebrow mb-2">Link a repository</p>
							{linkableRepos.length > 0 ? (
								<div className="scrollbar-stable max-h-[min(24rem,45dvh)] overflow-y-auto rounded-md border">
									{linkableRepos.map((repo) => (
										<div
											key={repo.githubRepoId}
											className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
										>
											<span className="flex min-w-0 items-center gap-1.5 text-sm">
												<span className="truncate">{repo.fullName}</span>
												{repo.private && (
													<Badge variant="outline" className="shrink-0 gap-1">
														<LockIcon className="size-3" />
														Private
													</Badge>
												)}
											</span>
											<Button
												variant="outline"
												size="sm"
												className="shrink-0"
												onClick={() =>
													linkMutation.mutate({
														githubRepoId: repo.githubRepoId,
														installationId: repo.installationId,
													})
												}
												disabled={linkMutation.isPending}
											>
												Link
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									{!availableRepos
										? "Loading repositories…"
										: query
											? "No repositories match your search."
											: "No more repositories to link."}
								</p>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
