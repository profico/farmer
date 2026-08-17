import { ChatCircleDotsIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Answer, AnswerActions } from "#/components/assistant/answer.tsx";
import { MobileChatBar } from "#/components/assistant/chat-rail.tsx";
import {
	ApprovalCard,
	AssistantLoader,
	ToolTraceList,
} from "#/components/assistant/primitives.tsx";
import { PromptBar } from "#/components/assistant/prompt-bar.tsx";
import { useAssistantStream } from "#/components/assistant/use-assistant-stream.ts";
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
	loader: async ({ context, params }) => {
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

function AssistantPage() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const conversationId = Route.useSearch().c ?? null;

	const { data: settings } = useQuery(assistantSettingsQuery(orgSlug));
	const { data: thread } = useQuery({
		...conversationQuery(orgSlug, conversationId ?? ""),
		enabled: Boolean(conversationId),
	});

	const scrollRef = useRef<HTMLDivElement>(null);

	const invalidateThread = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).assistant, "conversations"],
			}),
			conversationId
				? queryClient.invalidateQueries({
						queryKey: conversationQuery(orgSlug, conversationId).queryKey,
					})
				: Promise.resolve(),
			// A turn can have written a time entry, so anything reading them is now
			// stale. Named through the same root the writes use, so this cannot drift
			// from what `createTimeEntry` invalidates.
			queryClient.invalidateQueries({
				queryKey: queryKeys(orgSlug).timeEntries,
			}),
		]);
	};

	const stream = useAssistantStream({
		onDone: async () => {
			await invalidateThread();
			// Only after the server's copy has landed, or the answer would show
			// twice — once live, once persisted — for a frame.
			stream.reset();
		},
	});

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
		const row = messages.find((message) => message.pendingApproval);
		const answered = new Set(
			messages
				.filter((message) => message.role === "tool")
				.map((message) => message.toolCallId),
		);
		const call = row?.toolCalls?.find((entry) => !answered.has(entry.id));
		if (!row || !call) return null;
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

	// Follow the answer down. Scrolling the container rather than the document:
	// this screen owns the viewport height, so the document never scrolls.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the effect reacts to the transcript growing, and these three are what grows it
	useEffect(() => {
		const element = scrollRef.current;
		if (element) element.scrollTop = element.scrollHeight;
	}, [messages.length, stream.streamingText, pending]);

	const send = async (text: string) => {
		let id = conversationId;
		if (!id) {
			const conversation = await startChat.mutateAsync();
			id = conversation.id;
		}
		await stream.send(id, text);
	};

	if (!settings?.configured || !settings.enabled) {
		return (
			<PageFull>
				<div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
					<ChatCircleDotsIcon className="size-8 text-faint" />
					<h1 className="h2">The assistant isn't connected</h1>
					<p className="lede max-w-[48ch]">
						An admin can connect this workspace's OpenRouter account under
						Settings → Integrations. Until then there's nothing to ask.
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
					<ScrollFade
						viewportRef={scrollRef}
						className="min-h-0 flex-1 overflow-auto"
					>
						{/* The bottom padding is the composer's height plus its margin —
						    the transcript scrolls under a floating pill, so without it the
						    last answer stops behind the thing you reply in. */}
						{/* Less top padding on a phone — the thread bar above already
						    stands the transcript off the island's edge. */}
						<div className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 pt-4 pb-28 md:pt-8">
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
												className="rounded-control px-2.5 py-1.5 text-left text-[13px] text-ink-2 shadow-hairline transition-colors duration-100 hover:bg-hover hover:text-ink"
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
										<div key={message.id} className="flex justify-end">
											<div className="max-w-[85%] rounded-card bg-inset px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
												{message.content}
											</div>
										</div>
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
												stream.isStreaming
													? undefined
													: (prompt) => void send(prompt)
											}
										/>
										<AnswerActions text={message.content} />
									</div>
								);
							})}

							{stream.traces.length > 0 && (
								<ToolTraceList
									traces={stream.traces}
									working={stream.isStreaming && !pending}
								/>
							)}

							{stream.streamingText && <Answer text={stream.streamingText} />}

							{stream.isStreaming &&
								!stream.streamingText &&
								stream.traces.length === 0 && <AssistantLoader />}

							{pending && conversationId && (
								<ApprovalCard
									pending={pending}
									busy={stream.isStreaming}
									onDecide={(decision, selectedRowIds) =>
										void stream.resolve(
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
							<PromptBar
								onSend={(text) => void send(text)}
								onStop={stream.stop}
								busy={stream.isStreaming}
								disabled={startChat.isPending}
								autoFocus
							/>
						</div>
					</div>
				</div>
			</div>
		</PageFull>
	);
}
