import {
	CaretDownIcon,
	ChatsIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet.tsx";
import {
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
} from "#/components/ui/sidebar.tsx";
import { cn } from "#/lib/utils.ts";
import { conversationsQuery } from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import { deleteConversation, renameConversation } from "#/server/assistant.ts";

/**
 * The conversation list, and its two frames: the sidebar's Chat tab on desktop
 * and a bottom sheet on a phone.
 *
 * The list lives here rather than on the assistant page because the page used
 * to carry its own rail, which meant two vertical lists side by side the whole
 * time you were chatting — the app's nav and the thread list, each ~240px, each
 * claiming to be the sidebar. One sidebar that changes what it lists is the
 * honest version of that.
 *
 * Which conversation is open is a search param (`?c=`) on the assistant route,
 * not state anywhere: these components are mounted by the layout and the page
 * respectively, so the URL is the only thing both can see.
 */

/**
 * The rows themselves, frame-agnostic.
 *
 * Its responsive classes read backwards until you know where it renders: the
 * base sizes are the PHONE's, because the only mobile frame is the sheet, and
 * the `md:` overrides are the sidebar's, because the sidebar itself is
 * `md:flex` and so cannot exist below that width. Same reason the delete button
 * is visible by default and hover-revealed only from `md` up — a touch screen
 * has no hover to reveal it with, which would have made a thread undeletable on
 * a phone.
 */
export function ConversationList({
	orgSlug,
	onNavigate,
}: {
	orgSlug: string;
	/** Called when a row is followed — the sheet closes on it; the sidebar has nothing to close. */
	onNavigate?: () => void;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	// `strict: false` because this renders on every screen under /$orgSlug, most
	// of which have no `c` param at all — the sidebar is not inside the assistant
	// route, so it cannot read that route's search in the usual typed way.
	const openId = useSearch({ strict: false, select: (search) => search.c });

	const { data: conversations = [], isPending } = useQuery(
		conversationsQuery(orgSlug),
	);

	// Which row is being renamed, and the draft it holds. One row at a time, so
	// this is an id rather than a flag per conversation.
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draft, setDraft] = useState("");
	// Escape has to cancel, and it blurs the input on the way out — without this
	// the blur handler would then commit the very edit Escape just abandoned.
	const cancelledRef = useRef(false);

	const focusOnMount = useCallback((el: HTMLInputElement | null) => {
		el?.focus();
		el?.select();
	}, []);

	const rename = useMutation({
		mutationFn: (input: { conversationId: string; title: string }) =>
			renameConversation({ data: input }),
		onSuccess: async (_result, input) => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: [...queryKeys(orgSlug).assistant, "conversations"],
				}),
				// The thread itself carries the title too, and the page reads it from
				// there rather than from this list.
				queryClient.invalidateQueries({
					queryKey: [
						...queryKeys(orgSlug).assistant,
						"conversation",
						input.conversationId,
					],
				}),
			]);
		},
		onError: (error) => toast.error(error.message ?? "Could not rename"),
	});

	/** Commit the draft, unless it is empty or unchanged — neither is a rename. */
	const commit = (conversation: { id: string; title: string }) => {
		const title = draft.trim();
		setEditingId(null);
		if (!title || title === conversation.title) return;
		rename.mutate({ conversationId: conversation.id, title });
	};

	const remove = useMutation({
		mutationFn: (id: string) =>
			deleteConversation({ data: { conversationId: id } }),
		onSuccess: async (_result, id) => {
			// Deleting the thread you are reading leaves the page pointed at a
			// conversation that no longer exists, so step off it first.
			if (openId === id) {
				await navigate({
					to: "/$orgSlug/assistant",
					params: { orgSlug },
					search: {},
					replace: true,
				});
			}
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).assistant, "conversations"],
			});
		},
		onError: (error) => toast.error(error.message ?? "Could not delete"),
	});

	return (
		<div className="flex flex-col gap-0.5">
			{/* A link, not a button: "new chat" IS the assistant route with no
			    conversation, so it should be middle-clickable and shareable like
			    every other destination. */}
			<Link
				to="/$orgSlug/assistant"
				params={{ orgSlug }}
				search={{}}
				onClick={onNavigate}
				className={cn(
					"flex items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-base transition-colors duration-100 md:py-2 md:text-sm",
					openId ? "hover:bg-hover-2" : "bg-sidebar-accent",
				)}
			>
				<PlusIcon weight="regular" className="size-4" />
				New chat
			</Link>

			{isPending && (
				<p className="px-2.5 py-1 text-2xs text-muted-foreground">Loading…</p>
			)}
			{!isPending && conversations.length === 0 && (
				<p className="px-2.5 py-1 text-2xs text-muted-foreground">
					Nothing yet — ask something.
				</p>
			)}

			{conversations.map((conversation) => (
				<div
					key={conversation.id}
					className={cn(
						"group flex items-center gap-1 rounded-2xl pr-1 transition-colors duration-100",
						conversation.id === openId
							? "bg-sidebar-accent"
							: "hover:bg-hover-2",
					)}
				>
					{/* Renaming happens in place rather than in a dialog. The rail is
					    ~240px on desktop and a bottom sheet on a phone, so a modal to
					    edit one short string is more chrome than the string. */}
					{editingId === conversation.id ? (
						<input
							ref={focusOnMount}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onBlur={() => {
								if (cancelledRef.current) {
									cancelledRef.current = false;
									return;
								}
								commit(conversation);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									commit(conversation);
								}
								if (event.key === "Escape") {
									event.preventDefault();
									cancelledRef.current = true;
									setEditingId(null);
								}
							}}
							aria-label={`Rename ${conversation.title}`}
							className="min-w-0 flex-1 rounded-2xl bg-transparent py-2.5 pl-2.5 text-base outline-none md:py-2 md:text-sm"
						/>
					) : (
						<Link
							to="/$orgSlug/assistant"
							params={{ orgSlug }}
							search={{ c: conversation.id }}
							onClick={onNavigate}
							className="min-w-0 flex-1 truncate py-2.5 pl-2.5 text-left text-base md:py-2 md:text-sm"
							title={conversation.title}
						>
							{conversation.title}
						</Link>
					)}
					{editingId !== conversation.id && (
						<>
							<button
								type="button"
								aria-label={`Rename ${conversation.title}`}
								onClick={() => {
									cancelledRef.current = false;
									setDraft(conversation.title);
									setEditingId(conversation.id);
								}}
								// Same reveal rule as the delete button beside it; the note
								// on that one explains why it is not `group-focus-within`.
								className="quiet shrink-0 p-2.5 transition-opacity duration-100 focus-visible:opacity-100 md:p-0 md:opacity-0 md:group-hover:opacity-100"
							>
								<PencilSimpleIcon
									weight="regular"
									className="size-4 md:size-3.5"
								/>
							</button>
							<button
								type="button"
								aria-label={`Delete ${conversation.title}`}
								onClick={() => remove.mutate(conversation.id)}
								disabled={remove.isPending}
								// Revealed on hover from `md` up, but never on focus-within's
								// behalf alone — keyboard users get it via focus-visible so it can
								// be reached by tabbing without it being permanently visible for
								// everyone. Below `md` it simply stays visible; see the note above.
								className="quiet shrink-0 p-2.5 transition-opacity duration-100 focus-visible:opacity-100 md:p-0 md:opacity-0 md:group-hover:opacity-100"
							>
								<TrashIcon weight="regular" className="size-4 md:size-3.5" />
							</button>
						</>
					)}
				</div>
			))}
		</div>
	);
}

/** The list as the sidebar's Chat tab. Desktop only — the sidebar is `md:flex`. */
export function ChatRail({ orgSlug }: { orgSlug: string }) {
	return (
		<SidebarGroup>
			<SidebarGroupLabel>Chats</SidebarGroupLabel>
			<SidebarGroupContent>
				<ConversationList orgSlug={orgSlug} />
			</SidebarGroupContent>
		</SidebarGroup>
	);
}

/**
 * The same list on a phone, plus the one thing the phone had no way to say.
 *
 * The sidebar — and with it the Browse/Chat switch and the thread list — is
 * `md:flex`, so below that width the assistant was a one-shot chat: every
 * visit started a new thread, past ones were reachable only by hand-typing
 * `?c=<uuid>`, and deleting one was impossible. This bar is the mobile door to
 * all three.
 *
 * The trigger is labelled with the OPEN thread rather than something generic
 * like "Chats", because on a phone nothing else on the screen names the
 * conversation you are reading.
 */
export function MobileChatBar({ orgSlug }: { orgSlug: string }) {
	const [open, setOpen] = useState(false);
	const openId = useSearch({ strict: false, select: (search) => search.c });
	const { data: conversations = [] } = useQuery(conversationsQuery(orgSlug));
	const title = conversations.find(
		(conversation) => conversation.id === openId,
	)?.title;

	return (
		<div className="flex shrink-0 items-center gap-1 px-2 pt-2 md:hidden">
			<button
				type="button"
				onClick={() => setOpen(true)}
				// `min-h-11` rather than padding: 44px is the touch target, and letting
				// the text's own line-height set the height gave 34.
				className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 rounded-2xl px-2.5 text-left text-sm text-ink-2 transition-colors duration-100 active:bg-hover"
			>
				<ChatsIcon weight="regular" className="size-4 shrink-0" />
				<span className="min-w-0 flex-1 truncate">{title ?? "New chat"}</span>
				<CaretDownIcon
					weight="regular"
					className="size-3.5 shrink-0 text-faint"
				/>
			</button>
			{/* Only once a thread is open: on a new one it would be a control that
			    navigates to the screen you are already looking at. The sheet's own
			    "New chat" row is the other, always-present way. */}
			{openId && (
				<Link
					to="/$orgSlug/assistant"
					params={{ orgSlug }}
					search={{}}
					aria-label="New chat"
					className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-ink-2 transition-colors duration-100 active:bg-hover"
				>
					<PlusIcon weight="regular" className="size-4" />
				</Link>
			)}

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent
					side="bottom"
					className="max-h-[80svh] rounded-t-2xl pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
				>
					<div className="absolute top-2 left-1/2 h-1 w-9 -translate-x-1/2 rounded-full bg-line" />
					<SheetHeader className="shrink-0 px-5 pt-2.5 pb-0">
						<SheetTitle>Chats</SheetTitle>
						<SheetDescription className="sr-only">
							Your assistant conversations.
						</SheetDescription>
					</SheetHeader>
					{/* Closes on navigation, not on delete: deleting the open thread
					    already steps the page off it, and someone tidying up their
					    history is rarely done after one. */}
					<div className="min-h-0 flex-1 overflow-y-auto px-2">
						<ConversationList
							orgSlug={orgSlug}
							onNavigate={() => setOpen(false)}
						/>
					</div>
				</SheetContent>
			</Sheet>
		</div>
	);
}
