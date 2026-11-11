import {
	ChatCircleDotsIcon,
	DeviceMobileIcon,
	InfoIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Answer } from "#/components/assistant/answer.tsx";
import { UserMessage } from "#/components/assistant/user-message.tsx";
import { MenuPath } from "#/components/menu-path.tsx";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "#/components/ui/avatar.tsx";
import { Button } from "#/components/ui/button.tsx";
import { PageFull } from "#/components/ui/page-header.tsx";
import { When } from "#/components/when.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	assistantSettingsQuery,
	sharedConversationQuery,
} from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import { unshareConversation } from "#/server/assistant.ts";

/** A chat that its owner shared with the organization. Read only: no composer,
 *  no approval card and no undo. */
export const Route = createFileRoute("/$orgSlug/assistant_/shared/$id")({
	beforeLoad: ({ context, params }) => {
		if (!context.assistantEnabled) {
			throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug } });
		}
	},
	component: SharedChatPage,
});

function Explain({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<PageFull>
			<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
				<ChatCircleDotsIcon className="size-8 text-faint" />
				<h1 className="h2">{title}</h1>
				<p className="lede max-w-[48ch]">{children}</p>
			</div>
		</PageFull>
	);
}

function StopSharing({ orgSlug, id }: { orgSlug: string; id: string }) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const stop = useMutation({
		mutationFn: () => unshareConversation({ data: { conversationId: id } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: queryKeys(orgSlug).assistant,
			});
			toast.success("Sharing stopped");
			await navigate({
				to: "/$orgSlug/assistant",
				params: { orgSlug },
				search: {},
			});
		},
		onError: (error) => toast.error(error.message ?? "Could not stop sharing"),
	});
	return (
		<Button
			variant="outline"
			disabled={stop.isPending}
			onClick={() => stop.mutate()}
		>
			Stop sharing
		</Button>
	);
}

const isPhone = () => /Android|iPhone|iPad/.test(navigator.userAgent);

/** A link to the app, on a phone only. The server snapshot is false for SSR. */
function OpenInApp({ orgSlug, id }: { orgSlug: string; id: string }) {
	const phone = useSyncExternalStore(
		() => () => {},
		isPhone,
		() => false,
	);
	if (!phone) return null;
	const server = encodeURIComponent(window.location.origin);
	return (
		<Button
			variant="outline"
			nativeButton={false}
			render={
				<a
					href={`farmer://assistant/shared/${id}?org=${encodeURIComponent(orgSlug)}&server=${server}`}
				>
					<DeviceMobileIcon />
					Open in the app
				</a>
			}
		/>
	);
}

function SharedChatPage() {
	const orgSlug = useOrgSlug();
	const { id } = Route.useParams();
	const { role } = Route.useRouteContext();
	const { data: settings } = useQuery(assistantSettingsQuery(orgSlug));
	const { data, isPending, isError } = useQuery(
		sharedConversationQuery(orgSlug, id),
	);

	if (settings && (!settings.configured || !settings.enabled)) {
		return (
			<Explain title="The assistant isn't connected">
				An admin can connect this workspace's OpenRouter account under{" "}
				<MenuPath steps={["Settings", "AI"]} />. Until then you cannot read
				shared chats.
			</Explain>
		);
	}
	if (isError) {
		return (
			<Explain title="This chat is not available">
				The owner may have stopped sharing it, or deleted it.{" "}
				<Link
					to="/$orgSlug/assistant"
					params={{ orgSlug }}
					search={{}}
					className="underline underline-offset-2"
				>
					Go to the assistant
				</Link>
			</Explain>
		);
	}
	if (isPending) {
		return (
			<PageFull>
				<p className="text-sm text-muted-foreground">Loading…</p>
			</PageFull>
		);
	}

	const isAdmin = role === "owner" || role === "admin";
	return (
		<PageFull>
			<div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-6">
				<div className="flex flex-wrap items-center gap-3 rounded-card bg-inset px-3.5 py-3 text-sm">
					<InfoIcon weight="regular" className="size-4 shrink-0 text-ink-2" />
					<Avatar size="sm">
						{data.sharedBy.image && (
							<AvatarImage src={data.sharedBy.image} alt="" />
						)}
						<AvatarFallback>{data.sharedBy.name.slice(0, 1)}</AvatarFallback>
					</Avatar>
					<p className="min-w-0 flex-1">
						Shared by {data.sharedBy.name} on <When date={data.sharedAt} />. It
						can show data that you cannot normally see.
					</p>
					<OpenInApp orgSlug={orgSlug} id={id} />
					{isAdmin && <StopSharing orgSlug={orgSlug} id={id} />}
				</div>
				<h1 className="h2">{data.conversation.title}</h1>
				{data.messages.map((message) => {
					if (message.role === "user") {
						return <UserMessage key={message.id} text={message.content} />;
					}
					if (message.role === "assistant" && message.content.trim()) {
						return <Answer key={message.id} text={message.content} />;
					}
					return null;
				})}
			</div>
		</PageFull>
	);
}
