import { ArrowClockwiseIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { conversationQuery } from "#/queries/assistant.ts";
import { queryKeys } from "#/queries/keys.ts";
import {
	rewindAssistantThread,
	undoAssistantWrite,
} from "#/server/assistant.ts";

import type { ToolTrace } from "./assistant-runs.tsx";
import { ToolTraceList } from "./primitives.tsx";

/** A stored write that has an Undo, or that was undone. */
export function StoredWriteTrace({
	conversationId,
	messageId,
	trace,
	done,
	locked,
}: {
	conversationId: string;
	messageId: string;
	trace: Pick<ToolTrace, "toolCallId" | "name" | "arguments">;
	done: boolean;
	/** A turn runs or a card waits. */
	locked: boolean;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const undo = useMutation({
		mutationFn: () =>
			undoAssistantWrite({ data: { conversationId, messageId } }),
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: conversationQuery(orgSlug, conversationId).queryKey,
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys(orgSlug).timeEntries,
				}),
			]),
		onError: (error) => toast.error(error.message ?? "Could not undo"),
	});
	return (
		<ToolTraceList
			working={false}
			open
			traces={[
				{
					...trace,
					ok: true,
					undo: {
						done,
						busy: undo.isPending,
						disabled: locked,
						onUndo: () => undo.mutate(),
					},
				},
			]}
		/>
	);
}

/** Disabled buttons do not fire pointer events, so the span takes the hover. */
function WithReason({
	reason,
	children,
}: {
	reason: string | null;
	children: React.ReactNode;
}) {
	if (!reason) return children;
	return (
		<TooltipProvider delay={150}>
			<Tooltip>
				<TooltipTrigger render={<span className="inline-flex" />}>
					{children}
				</TooltipTrigger>
				<TooltipContent>{reason}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

/**
 * The actions on the last question: Edit and Retry. Both take the question
 * back from the server (`rewindAssistantThread`), then send the text again as
 * a new turn.
 */
export function LastQuestionActions({
	conversationId,
	text,
	reason,
	onSend,
	editing,
	onEditingChange,
}: {
	conversationId: string;
	text: string;
	/** Why the actions are off, or null. */
	reason: string | null;
	onSend: (text: string) => Promise<boolean>;
	editing: boolean;
	onEditingChange: (editing: boolean) => void;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(text);
	const resend = useMutation({
		mutationFn: async (next: string) => {
			await rewindAssistantThread({ data: { conversationId } });
			await queryClient.invalidateQueries({
				queryKey: conversationQuery(orgSlug, conversationId).queryKey,
			});
			if (!(await onSend(next))) throw new Error("The message was not sent");
		},
		onSuccess: () => onEditingChange(false),
		onError: (error) => toast.error(error.message ?? "Could not send again"),
	});

	if (editing) {
		return (
			<div className="flex flex-col items-end gap-2">
				<Textarea
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					aria-label="Edit your question"
					className="min-h-20 w-full"
					autoFocus
				/>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onEditingChange(false)}
					>
						Cancel
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={Boolean(reason) || !draft.trim() || resend.isPending}
						onClick={() => resend.mutate(draft.trim())}
					>
						Send
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="flex justify-end gap-1">
			<WithReason reason={reason}>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={Boolean(reason)}
					onClick={() => {
						setDraft(text);
						onEditingChange(true);
					}}
				>
					<PencilSimpleIcon />
					Edit
				</Button>
			</WithReason>
			<WithReason reason={reason}>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={Boolean(reason) || resend.isPending}
					onClick={() => resend.mutate(text)}
				>
					<ArrowClockwiseIcon />
					Retry
				</Button>
			</WithReason>
		</div>
	);
}
