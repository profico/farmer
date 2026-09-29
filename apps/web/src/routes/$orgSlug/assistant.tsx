import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";

import {
	Answer,
	AnswerActions,
	StreamingAnswer,
} from "#/components/assistant/answer.tsx";
import {
	useAssistantActions,
	useAssistantRun,
} from "#/components/assistant/assistant-runs.tsx";
import { MobileChatBar } from "#/components/assistant/chat-rail.tsx";
import {
	ApprovalCard,
	AssistantLoader,
	ToolTraceList,
} from "#/components/assistant/primitives.tsx";
import { PromptBar } from "#/components/assistant/prompt-bar.tsx";
import { MenuPath } from "#/components/menu-path.tsx";
import { FadeSwap } from "#/components/ui/fade-swap.tsx";
import { PageFull } from "#/components/ui/page-header.tsx";
import { ScrollFade } from "#/components/ui/scroll-fade.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	assistantSettingsQuery,
	conversationQuery,
	conversationsQuery,
} from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import { createConversation } from "#/server/assistant.ts";

// The open conversation lives in the URL, not in component state.
//
// It has to: the thread list is in the SIDEBAR now, which is mounted by the
// layout route and knows nothing about this component. The URL is the one place
// both can read and write. It also makes a conversation linkable and survives a
// reload, which the old local state did not.
const searchSchema = z.object({ c: z.uuid().optional() });

export const Route = createFileRoute("/$orgSlug/assistant")({
	validateSearch: searchSchema,
	// The deployment switch (`ASSISTANT_ENABLED`), resolved by the layout route's
	// `getPublicAppConfig` call so this costs no extra round trip. Sending them
	// home rather than rendering an explanation: an operator-level switch is not
	// something the reader can act on, and the nav row is gone anyway, so the
	// only way to arrive here is a stale tab or a typed URL.
	beforeLoad: ({ context, params }) => {
		if (!context.assistantEnabled) {
			throw redirect({ to: "/$orgSlug", params: { orgSlug: params.orgSlug } });
		}
	},
	// The open thread is a search param, so it has to be a loader dep or the
	// router treats every conversation as the same navigation and preloads
	// nothing for it.
	loaderDeps: ({ search }) => ({ c: search.c }),
	loader: async ({ context, params, deps }) => {
		// Awaited on the server, warmed on the client, and the difference is
		// whether there is already a screen to look at.
		//
		// Server: this is somebody opening a link to a thread, and nothing is
		// rendered yet — so the document may as well contain the transcript. It
		// then arrives whole and already scrolled to its newest message, instead
		// of painting the empty "What can I help with?" screen for as long as one
		// round trip takes and then replacing it.
		//
		// Client: `defaultPreload: "intent"` runs this while the pointer is still
		// approaching a thread in the sidebar, so the transcript is usually cached
		// before the click lands. When it is not — a touch, a keyboard, a fast
		// click — the page keeps showing the thread you were reading and swaps
		// when the new one lands (`placeholderData` below). Blocking the route
		// instead would replace a readable screen with a pending one.
		if (deps.c) {
			const thread = conversationQuery(params.orgSlug, deps.c);
			if (import.meta.env.SSR)
				await context.queryClient.ensureQueryData(thread);
			else void context.queryClient.prefetchQuery(thread);
		}
		await Promise.all([
			context.queryClient.ensureQueryData(
				assistantSettingsQuery(params.orgSlug),
			),
			context.queryClient.ensureQueryData(conversationsQuery(params.orgSlug)),
		]);
	},
	component: AssistantPage,
});

const SUGGESTIONS = [
	"How many hours did I log last week?",
	"What have I not filed to a project yet this month?",
	"Which project took most of my time in March?",
];

/**
 * Lands the transcript at its end, once, as this thread's content mounts.
 *
 * It renders nothing and exists for its timing: it is keyed with the panel
 * around it, so its layout effect runs on the frame the new transcript enters
 * the DOM — the point at which `scrollHeight` first means the thread you
 * clicked. The same effect written on the page would run on the frame the URL
 * changed, which is a scroll to the end of the thread you just left.
 *
 * A layout effect, not an effect: the position is set before the browser paints,
 * so a thread opens AT its newest message rather than opening at the top and
 * being moved.
 */
function PinToEnd({ pin }: { pin: () => void }) {
	useLayoutEffect(() => {
		pin();
	}, [pin]);
	return null;
}

/** One thing the user said. Rendered from the transcript, and — for the turn in
 *  flight — from the text the composer just sent. */
function UserMessage({ text }: { text: string }) {
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] rounded-card bg-inset px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
				{text}
			</div>
		</div>
	);
}

function AssistantPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const conversationId = Route.useSearch().c ?? null;

	const { data: settings } = useQuery(assistantSettingsQuery(orgSlug));
	const { data: thread } = useQuery({
		...conversationQuery(orgSlug, conversationId ?? ""),
		enabled: Boolean(conversationId),
		// Hold the thread you were reading on screen until the one you clicked has
		// arrived. Without it the transcript empties the moment the URL changes,
		// so a switch read as: thread → the "What can I help with?" hero for a
		// frame → thread. The swap below then happens ONCE, on content that is
		// already there, which is also what makes landing at the bottom possible —
		// you cannot scroll to the end of a transcript that has not loaded.
		//
		// Only when another thread is actually on its way, though. "New chat" is
		// the one navigation with nothing arriving to replace the placeholder —
		// the query is `enabled: false` and never refetches — so holding it there
		// left the previous conversation on screen for the whole of the new one,
		// with `viewKey` still naming it so even the swap could not clear it.
		placeholderData: conversationId ? (previous) => previous : undefined,
	});

	const scrollRef = useRef<HTMLDivElement>(null);
	const pinToEnd = useCallback(() => {
		const element = scrollRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	}, []);
	// Whether the transcript is following its own end. Reading up is a decision,
	// and an answer that arrives while you are three screens back should not
	// haul you down to it — so this stops being true the moment the reader
	// scrolls away from the bottom, and starts again when they return.
	const pinnedRef = useRef(true);

	// The turn in flight in THIS thread, and the actions that start one. Both
	// come from the layout's `AssistantRunsProvider`, not from state here: a turn
	// belongs to its conversation, so opening another thread must not show it
	// this one's answer — and the thread list in the sidebar, which this
	// component does not contain, needs to know which threads are working.
	const actions = useAssistantActions();
	const stream = useAssistantRun(conversationId);

	const startChat = useMutation({
		mutationFn: () => createConversation({ data: {} }),
		onSuccess: async (conversation) => {
			// `replace`, so the empty composer and the thread it became are one
			// entry in history — Back should leave the assistant, not undo the act
			// of starting to type.
			await navigate({
				to: "/$orgSlug/assistant",
				params: { orgSlug },
				search: { c: conversation.id },
				replace: true,
			});
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).assistant, "conversations"],
			});
		},
		onError: (error) => toast.error(error.message ?? "Could not start a chat"),
	});

	const messages = thread?.messages ?? [];

	// Whether the server's own row for the message in flight is already in the
	// transcript above. It normally is not — the refetch that brings it in is the
	// one at the END of the turn, by which point the live copy has been dropped.
	// A thread refetched MID-turn is the exception: the 30s `staleTime` runs out
	// while you are reading another thread, coming back re-runs the loader, and
	// the stored row lands with the turn still working. Drawn unconditionally,
	// the question then sat on screen twice until the answer finished.
	const sentMessageStored =
		stream.sentMessageId !== null &&
		messages.some((message) => message.id === stream.sentMessageId);

	// The approval card, from the live stream if a turn is in flight and from the
	// stored row otherwise.
	//
	// The second half is the point: `pendingApproval` lives on the message
	// (assistant.service.ts) precisely so a write waiting for consent outlives
	// the SSE connection that proposed it. Without this fallback the database
	// would remember the pending write and the page would not, leaving a
	// conversation that is suspended forever with nothing on screen to resolve
	// it — and the next question then 400s, because the model's tool_call has no
	// result.
	const storedPending = (() => {
		const index = messages.findIndex((message) => message.pendingApproval);
		const row = messages[index];
		if (!row) return null;
		// Only the tool rows of THIS turn answer its calls — up to the next
		// assistant row. A provider may reuse call ids across turns, and an older
		// turn's answer to the same id would hide a card that is really waiting.
		// Mirrors `turnRows` in assistant.service.ts.
		const after = messages.slice(index + 1);
		const end = after.findIndex((message) => message.role === "assistant");
		const answered = new Set(
			(end === -1 ? after : after.slice(0, end))
				.filter((message) => message.role === "tool")
				.map((message) => message.toolCallId),
		);
		const call = row.toolCalls?.find((entry) => !answered.has(entry.id));
		if (!call) return null;
		return {
			toolCallId: call.id,
			name: call.name,
			summary: row.approvalSummary ?? call.name.replaceAll("_", " "),
			arguments: call.arguments,
			// The rows as they were when consent was asked for, and whether they
			// were tickable then — both stored on the row for the same reason the
			// summary is (see the column's note in db/schema/assistant.ts).
			preview: row.approvalPreview ?? null,
			selectable: Boolean(row.approvalPreview?.selectable),
		};
	})();
	const pending = stream.pending ?? storedPending;

	// Which transcript is on screen — the thread that has actually loaded, not
	// the one the URL is pointing at. They differ for as long as a click takes to
	// answer, and everything below keys off the former: the swap animates once,
	// when there is something new to show, and the scroll lands at the end of the
	// content that is really there.
	const viewKey = thread?.conversation.id ?? "new";

	// Follow the transcript's end. Scrolling the container rather than the
	// document: this screen owns the viewport height, so the document never
	// scrolls.
	//
	// A ResizeObserver rather than an effect on the things that grow it, because
	// height arrives later than state does — a thread mounts, then its tables lay
	// out, then a web font swaps in, and each of those moves the end of the
	// transcript after the render that "finished" it. Watching the height itself
	// covers all three, plus the streamed answer growing a line at a time.
	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const stick = () => {
			if (pinnedRef.current) pinToEnd();
		};
		const onScroll = () => {
			// A screenful of slack: "near the end" is where the next answer would
			// still be in view, not the last pixel, which momentum scrolling and
			// sub-pixel layout both undershoot.
			const distance =
				element.scrollHeight - element.scrollTop - element.clientHeight;
			pinnedRef.current = distance < 96;
		};
		element.addEventListener("scroll", onScroll, { passive: true });
		const observer = new ResizeObserver(stick);
		observer.observe(element);
		// The column inside it is what actually grows; the viewport's own height
		// only changes when the window does, which is the other reason to stick.
		const column = element.firstElementChild;
		if (column) observer.observe(column);
		return () => {
			element.removeEventListener("scroll", onScroll);
			observer.disconnect();
		};
	}, [pinToEnd]);

	// Opening a thread follows it again, whatever the last one was left at.
	// The jump itself belongs to `PinToEnd` inside the panel, which mounts with
	// the new transcript rather than with the decision to show it.
	useLayoutEffect(() => {
		pinnedRef.current = true;
	}, [viewKey]);

	/** Whether the message reached the server. The composer reads it to decide
	 *  whether to hand the draft back — see `PromptBar`. */
	const send = async (text: string) => {
		let id = conversationId;
		if (!id) {
			// A thread that could not be started has nothing to hold the message,
			// so this counts as undelivered like any other refusal. `startChat`
			// has already said so in a toast.
			const conversation = await startChat.mutateAsync().catch(() => null);
			if (!conversation) return false;
			id = conversation.id;
		}
		return actions.send(id, text);
	};

	if (settings?.keyUnreadable) {
		return (
			<PageFull>
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
					<ChatCircleDotsIcon className="size-8 text-faint" />
					<h1 className="h2">The assistant needs to be connected again</h1>
					<p className="lede max-w-[48ch]">
						The stored OpenRouter key can no longer be read. An admin can paste
						it again under <MenuPath steps={["Settings", "Integrations"]} />,
						and the assistant comes back with every conversation intact.
					</p>
				</div>
			</PageFull>
		);
	}

	if (!settings?.configured || !settings.enabled) {
		return (
			<PageFull>
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
					<ChatCircleDotsIcon className="size-8 text-faint" />
					<h1 className="h2">The assistant isn't connected</h1>
					<p className="lede max-w-[48ch]">
						An admin can connect this workspace's OpenRouter account under
						<MenuPath steps={["Settings", "Integrations"]} />. Until then
						there's nothing to ask.
					</p>
				</div>
			</PageFull>
		);
	}

	return (
		<PageFull padded={false} className="overflow-hidden">
			<div className="flex min-h-0 flex-1">
				{/* ── the thread ────────────────────────────────────────────────── */}
				{/* `relative` is the composer's positioning context — it floats over
				    this column, not over the window, so it stays inside the island and
				    off the sidebar. */}
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
					{/* Phone only, and it renders nothing above `md`: the thread list and
					    the Browse/Chat switch both live in the sidebar, which doesn't
					    exist at this width. */}
					<MobileChatBar orgSlug={orgSlug} />

					{/* The transcript scrolls; the composer below it does not. The
					    ordering is the whole layout: history moves upward under the
					    fade and the thing you type into never leaves the screen. */}
					{/* `@container` is what a table or a chart inside an answer measures
					    itself against when it needs to be wider than the reading column
					    — see `.answer-wide` in styles.css. It belongs on the scroller
					    rather than on the column outside it so the width a block may
					    claim is the width actually available to it, scrollbar and all. */}
					<ScrollFade
						viewportRef={scrollRef}
						className="@container min-h-0 flex-1 overflow-auto"
					>
						{/* The bottom padding is the composer's height plus its margin —
						    the transcript scrolls under a floating pill, so without it the
						    last answer stops behind the thing you reply in. */}
						{/* Less top padding on a phone — the thread bar above already
						    stands the transcript off the island's edge. */}
						<div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 pt-4 pb-28 md:pt-8">
							{/* Opening a thread is a swap, not a repaint: the one you were
							    reading lifts and fades, the one you asked for rises into its
							    place. Keyed on the LOADED thread, so it happens once, when
							    there is something to show — and the same crossfade the rest
							    of the app uses for a panel change, because that is what this
							    is. The live turn below stays out of it: those rows belong to
							    what is happening now rather than to the thread on screen, and
							    fading them with it would take the answer being streamed off
							    the screen mid-sentence. */}
							<FadeSwap activeKey={viewKey} className="flex flex-col gap-6">
								<PinToEnd pin={pinToEnd} />
								{messages.length === 0 && !stream.isStreaming && (
									<div className="flex flex-col gap-4 pt-10">
										<h1 className="h1">What can I help with?</h1>
										<p className="lede">
											I can read your tracked time and log more of it — anything
											I'd write is shown to you first.
										</p>
										<div className="mt-2 flex flex-col items-start gap-1.5">
											{SUGGESTIONS.map((suggestion) => (
												<button
													key={suggestion}
													type="button"
													onClick={() => void send(suggestion)}
													className="rounded-control px-2.5 py-1.5 text-left text-[13px] text-ink-2 shadow-hairline transition-colors duration-(--dur-fast) hover:bg-hover hover:text-ink"
												>
													{suggestion}
												</button>
											))}
										</div>
									</div>
								)}

								{messages.map((message) => {
									if (message.role === "user") {
										return (
											<UserMessage key={message.id} text={message.content} />
										);
									}
									if (message.role === "tool") return null;
									// An assistant row with no text is a pure tool turn; its trace
									// is rendered live above and its persisted form has nothing to
									// show, so it stays out of the transcript.
									if (!message.content.trim()) return null;
									return (
										// The group is what reveals the actions on hover — on the
										// whole answer, not on a strip under it, so the target is the
										// thing you were already reading.
										<div
											key={message.id}
											className="group/answer flex flex-col gap-2"
										>
											<Answer
												text={message.content}
												onFollowUp={
													stream.isStreaming || pending
														? undefined
														: (prompt) => void send(prompt)
												}
											/>
											<AnswerActions text={message.content} />
										</div>
									);
								})}
							</FadeSwap>

							{/* What was just typed, until the turn ends and the server's own
							    copy of it arrives with everything else. Without it a question
							    vanishes on send and the screen shows only the model working —
							    on a turn that runs tools, for long enough to wonder whether
							    the message was sent at all. */}
							{stream.sentMessage !== null && !sentMessageStored && (
								<UserMessage text={stream.sentMessage} />
							)}

							{stream.traces.length > 0 && (
								<ToolTraceList
									traces={stream.traces}
									working={stream.isStreaming && !pending}
								/>
							)}

							{/* Not `Answer`: the turn in flight is paced and revealed, and
							    the stored rows above it are neither. See `StreamingAnswer`
							    and `typeset.ts`. */}
							{stream.streamingText && (
								<StreamingAnswer
									text={stream.streamingText}
									streaming={stream.isStreaming}
								/>
							)}

							{stream.isStreaming &&
								!stream.streamingText &&
								stream.traces.length === 0 && <AssistantLoader />}

							{pending && conversationId && (
								<ApprovalCard
									pending={pending}
									busy={stream.isStreaming}
									onDecide={(decision, selectedRowIds) =>
										void actions.resolve(
											conversationId,
											pending.toolCallId,
											decision,
											selectedRowIds,
										)
									}
								/>
							)}

							{stream.error && (
								<p className="text-sm text-destructive">{stream.error}</p>
							)}
						</div>
					</ScrollFade>

					{/* Floating, not a shelf. It used to be a row under a rule, which
					    made the composer part of the furniture; now the transcript runs
					    the full height and passes behind it. `pointer-events-none` on the
					    frame so the strip of ground either side of the composer still
					    scrolls the thread — only the pill itself takes the mouse. The
					    transcript's own bottom padding is what keeps the last answer from
					    ending underneath it. */}
					<div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4">
						<div className="pointer-events-auto mx-auto w-full max-w-[46rem]">
							{/* Locked while a card waits. The server reads a message typed
							    past a card as "no" to it (see `abandonPendingCalls`), which
							    keeps the thread well-formed — but that is a fallback for a
							    stale tab, not a way anybody should answer. The card is. */}
							<PromptBar
								onSend={send}
								onStop={() => {
									if (conversationId) actions.stop(conversationId);
								}}
								busy={stream.isStreaming}
								disabled={startChat.isPending || Boolean(pending)}
								placeholder={
									pending
										? "Approve or decline the card above to continue"
										: undefined
								}
								autoFocus
							/>
						</div>
					</div>
				</div>
			</div>
		</PageFull>
	);
}
