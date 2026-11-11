import type { AssistantThread } from "@farmer/api-client";
import { useRouter } from "expo-router";
import { Platform, Share } from "react-native";

import { useSetThreadShared } from "../api/assistant";
import { useWhoami, useWorkspace } from "../api/queries";
import type { HeaderAction } from "../navigation/header-actions.shared";
import { showDialog } from "../ui/dialog";

/** The warning of the share dialog, as on the web. */
const warning = (orgName: string) =>
	`Anyone in ${orgName} with the link can read this chat. It can show data that you can see and they cannot, for example a team report. Share only what you would show them.`;

/** The web page of a shared chat. The app has no deep link for it yet. */
export const sharedLink = (origin: string, slug: string, id: string) =>
	`${origin.replace(/\/+$/, "")}/${slug}/assistant/shared/${id}`;

const shareLink = (link: string) =>
	Share.share(Platform.OS === "ios" ? { url: link } : { message: link });

/**
 * The buttons at the end of the header of a chat: the history, and, once the
 * chat has a thread, Share. Share asks first, then opens the share sheet with
 * the web link. A shared chat offers the link again and Stop sharing.
 */
export const useChatHeaderActions = (
	thread: AssistantThread | undefined,
): HeaderAction[] => {
	const router = useRouter();
	const w = useWorkspace();
	const setShared = useSetThreadShared();
	const orgName = useWhoami().data?.organization.name ?? "your workspace";
	const history: HeaderAction = {
		icon: "chats",
		label: "Chat history",
		onPress: () => router.dismissTo("/assistant"),
	};
	if (!thread) return [history];
	const link = sharedLink(w.origin, w.slug, thread.id);
	const change = (shared: boolean) =>
		setShared.mutate(
			{ id: thread.id, shared },
			{
				onSuccess: () => {
					if (shared) void shareLink(link);
				},
				onError: (failure) =>
					showDialog("The change was not saved", failure.message),
			},
		);
	const open = () =>
		showDialog(
			"Share this chat",
			warning(orgName),
			thread.sharedAt
				? [
						{ text: "Cancel", style: "cancel" },
						{
							text: "Stop sharing",
							style: "destructive",
							onPress: () => change(false),
						},
						{ text: "Share the link", onPress: () => void shareLink(link) },
					]
				: [
						{ text: "Cancel", style: "cancel" },
						{ text: "Share", onPress: () => change(true) },
					],
		);
	return [{ icon: "share", label: "Share this chat", onPress: open }, history];
};
