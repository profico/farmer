import { ShareNetworkIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { conversationsQuery } from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import { shareConversation, unshareConversation } from "#/server/assistant.ts";

const sharedUrl = (orgSlug: string, id: string) =>
	`${window.location.origin}/${orgSlug}/assistant/shared/${id}`;

const copyLink = async (url: string) => {
	try {
		await navigator.clipboard.writeText(url);
		toast.success("Link copied");
	} catch {
		toast.error("Could not copy the link");
	}
};

/**
 * The Share button of the open chat, and the dialog behind it. The warning
 * comes first: a chat holds results that were read with the owner's access.
 */
export function ShareChatButton({
	orgSlug,
	conversationId,
	className,
}: {
	orgSlug: string;
	conversationId: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const { data: conversations = [] } = useQuery(conversationsQuery(orgSlug));
	const shared = Boolean(
		conversations.find((c) => c.id === conversationId)?.sharedAt,
	);
	return (
		<>
			<button
				type="button"
				aria-label={shared ? "Sharing options" : "Share this chat"}
				onClick={() => setOpen(true)}
				className={
					className ??
					"flex size-9 shrink-0 items-center justify-center rounded-2xl text-ink-2 transition-colors duration-(--dur-fast) hover:bg-hover-2"
				}
			>
				<ShareNetworkIcon
					weight={shared ? "fill" : "regular"}
					className="size-4"
				/>
			</button>
			<ShareDialog
				open={open}
				onOpenChange={setOpen}
				orgSlug={orgSlug}
				conversationId={conversationId}
				shared={shared}
			/>
		</>
	);
}

function ShareDialog({
	open,
	onOpenChange,
	orgSlug,
	conversationId,
	shared,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	orgSlug: string;
	conversationId: string;
	shared: boolean;
}) {
	const queryClient = useQueryClient();
	const orgName = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.organization.name,
	});
	const url = sharedUrl(orgSlug, conversationId);
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: [...queryKeys(orgSlug).assistant, "conversations"],
		});

	const share = useMutation({
		mutationFn: () => shareConversation({ data: { conversationId } }),
		onSuccess: async () => {
			await refresh();
			await copyLink(url);
			onOpenChange(false);
		},
		onError: (error) => toast.error(error.message ?? "Could not share"),
	});
	const stop = useMutation({
		mutationFn: () => unshareConversation({ data: { conversationId } }),
		onSuccess: async () => {
			await refresh();
			toast.success("Sharing stopped");
			onOpenChange(false);
		},
		onError: (error) => toast.error(error.message ?? "Could not stop sharing"),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Share this chat</DialogTitle>
					<DialogDescription>
						Anyone in {orgName} with the link can read this chat. It can show
						data that you can see and they cannot, for example a team report.
						Share only what you would show them.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					{shared ? (
						<>
							<Button
								variant="outline"
								disabled={stop.isPending}
								onClick={() => stop.mutate()}
							>
								Stop sharing
							</Button>
							<Button onClick={() => void copyLink(url)}>Copy link</Button>
						</>
					) : (
						<Button disabled={share.isPending} onClick={() => share.mutate()}>
							Share and copy link
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
