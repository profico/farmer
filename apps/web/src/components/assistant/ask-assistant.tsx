import type { WeekStartsOn } from "@farmer/core/lib/time";
import { XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { useAssistantActions } from "#/components/assistant/assistant-runs.tsx";
import {
	buildPageContext,
	pageSearch,
	projectIdFromPath,
} from "#/components/assistant/page-context.ts";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";
import { useToday } from "#/hooks/use-today.ts";
import { queryKeys } from "#/queries/keys.ts";
import { projectQuery } from "#/queries/projects.ts";
import { createConversation } from "#/server/assistant.ts";

// Ask the assistant from any page. The shortcut opens one small dialog. Send
// starts a new chat in the run store of the layout, so the answer keeps
// streaming after the dialog closes.

// The server takes 10,000 characters; the rest is room for the page sentence.
const ASK_MAX_CHARS = 9000;

const isMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The shortcut as it is written on this platform. */
export function useShortcutLabel() {
	const mac = useSyncExternalStore(
		() => () => {},
		isMac,
		() => false,
	);
	return mac ? "⌘K" : "Ctrl K";
}

/** A small kbd for the shortcut, as it is written on this platform. */
export function AskShortcutHint() {
	const label = useShortcutLabel();
	return (
		<kbd className="mono shrink-0 rounded-sm bg-inset px-1 text-2xs text-faint">
			{label}
		</kbd>
	);
}

type ProviderProps = {
	orgSlug: string;
	timezone: string;
	weekStartsOn: WeekStartsOn;
	available: boolean;
	children: React.ReactNode;
};

export function AskAssistantProvider({
	available,
	children,
	...page
}: ProviderProps) {
	const [isOpen, setOpen] = useState(false);

	useEffect(() => {
		if (!available) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const chord = event.metaKey || event.ctrlKey;
			if (!chord || event.shiftKey || event.altKey || event.isComposing) return;
			if (event.key.toLowerCase() !== "k") return;
			event.preventDefault();
			setOpen((current) => !current);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [available]);

	if (!available) return children;
	return (
		<>
			{children}
			<AskDialog open={isOpen} onOpenChange={setOpen} {...page} />
		</>
	);
}

type DialogProps = Omit<ProviderProps, "available" | "children"> & {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

function AskDialog({ open, onOpenChange, ...page }: DialogProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{/* Without it, focus lands on the chip's remove button. */}
			<DialogContent initialFocus={inputRef}>
				{/* Mounted only while open, so the field and the chip start fresh. */}
				<AskForm
					{...page}
					inputRef={inputRef}
					close={() => onOpenChange(false)}
				/>
			</DialogContent>
		</Dialog>
	);
}

function AskForm({
	orgSlug,
	timezone,
	weekStartsOn,
	close,
	inputRef,
}: Omit<DialogProps, "open" | "onOpenChange"> & {
	close: () => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const actions = useAssistantActions();
	const today = useToday(timezone);
	const location = useRouterState({ select: (state) => state.location });
	const projectId = projectIdFromPath(location.pathname, orgSlug);
	const { data: project } = useQuery({
		...projectQuery(orgSlug, projectId ?? ""),
		enabled: Boolean(projectId),
	});
	const sentence = buildPageContext({
		pathname: location.pathname,
		search: pageSearch.safeParse(location.search).data ?? {},
		orgSlug,
		today,
		weekStartsOn,
		projectName: project?.name,
	});
	const [chip, setChip] = useState(true);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);

	const send = async () => {
		const question = text.trim();
		if (!question || busy) return;
		setBusy(true);
		try {
			const conversation = await createConversation({ data: {} });
			await queryClient.invalidateQueries({
				queryKey: [...queryKeys(orgSlug).assistant, "conversations"],
			});
			const message =
				chip && sentence ? `${sentence}\n\n${question}` : question;
			// Not awaited: the call returns when the whole answer is done.
			actions.send(conversation.id, message).catch((error: unknown) => {
				toast.error(
					error instanceof Error
						? error.message
						: "Could not send the question",
				);
			});
			close();
			toast("Asking the assistant", {
				action: {
					label: "Open chat",
					onClick: () =>
						void navigate({
							to: "/$orgSlug/assistant",
							params: { orgSlug },
							search: { c: conversation.id },
						}),
				},
			});
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not start a chat",
			);
			setBusy(false);
		}
	};

	return (
		<form
			className="grid grid-cols-[minmax(0,1fr)] gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void send();
			}}
		>
			<DialogHeader>
				<DialogTitle>Ask the assistant</DialogTitle>
				<DialogDescription>
					It starts a new chat. The answer keeps going if you leave this page.
				</DialogDescription>
			</DialogHeader>
			{sentence && chip && (
				<div className="flex w-fit max-w-full items-center gap-1 rounded-control bg-inset py-1 pr-1 pl-2.5 text-sm text-ink-2">
					<span className="min-w-0 truncate">{sentence}</span>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Remove the page from the question"
						onClick={() => setChip(false)}
					>
						<XIcon />
					</Button>
				</div>
			)}
			<Input
				ref={inputRef}
				aria-label="Your question"
				placeholder="Ask about your time, or log some"
				value={text}
				maxLength={ASK_MAX_CHARS}
				onChange={(event) => setText(event.target.value)}
			/>
			<div className="flex justify-end">
				<Button type="submit" disabled={!text.trim() || busy}>
					Send
				</Button>
			</div>
		</form>
	);
}
