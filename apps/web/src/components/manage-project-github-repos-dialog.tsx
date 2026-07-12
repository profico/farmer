import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Lock, Plug, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
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

	const { data: status } = useQuery({
		...githubConnectionStatusQuery(),
		enabled: open,
	});
	const { data: linkedRepos } = useQuery({
		...projectGithubReposQuery(projectId ?? ""),
		enabled: open && !!projectId,
	});
	const { data: availableRepos } = useQuery({
		...availableGithubReposQuery(),
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
				queryKey: projectGithubReposQuery(projectId ?? "").queryKey,
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
				queryKey: projectGithubReposQuery(projectId ?? "").queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not unlink repository");
		},
	});

	const linkedGithubRepoIds = new Set(
		linkedRepos?.map((r) => r.githubRepoId) ?? [],
	);
	const linkableRepos = (availableRepos ?? []).filter(
		(r) => !linkedGithubRepoIds.has(r.githubRepoId),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Manage GitHub repos</DialogTitle>
				</DialogHeader>

				{status && !status.connected ? (
					<div className="flex flex-col items-center gap-3 py-6 text-center">
						<Plug className="size-6 text-muted-foreground" />
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
						<div className="min-w-0">
							<p className="mb-1.5 text-xs font-semibold text-muted-foreground">
								Linked repositories
							</p>
							{linkedRepos && linkedRepos.length > 0 ? (
								<div className="-mx-1 max-h-40 overflow-y-auto rounded-md border">
									{linkedRepos.map((repo) => (
										<div
											key={repo.id}
											className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
										>
											<span className="flex min-w-0 items-center gap-1.5 text-sm">
												<span className="truncate">{repo.fullName}</span>
												{repo.private && (
													<Badge variant="outline" className="shrink-0 gap-1">
														<Lock className="size-3" />
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
												<XIcon className="size-3" />
												<span className="sr-only">Unlink</span>
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground">
									No repositories linked yet.
								</p>
							)}
						</div>

						<div className="min-w-0">
							<p className="mb-1.5 text-xs font-semibold text-muted-foreground">
								Link a repository
							</p>
							{linkableRepos.length > 0 ? (
								<div className="-mx-1 max-h-52 overflow-y-auto rounded-md border">
									{linkableRepos.map((repo) => (
										<div
											key={repo.githubRepoId}
											className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-b-0"
										>
											<span className="flex min-w-0 items-center gap-1.5 text-sm">
												<span className="truncate">{repo.fullName}</span>
												{repo.private && (
													<Badge variant="outline" className="shrink-0 gap-1">
														<Lock className="size-3" />
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
									{availableRepos
										? "No more repositories to link."
										: "Loading repositories…"}
								</p>
							)}
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
