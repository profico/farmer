// Ported from Beautiful UI's PromptBar.tsx (MIT © 2026 Shane Levine).
//
// What came out, and why:
//   - `glimm`, the WebGL shader that fires a rainbow sweep when you pick the
//     flagship model. A real npm dependency and a whole canvas, for a
//     celebration this app has no occasion for.
//   - the self-running AUTO_STEPS walkthrough, the fake @-sources, the fake
//     /-commands, the fake dictation and the fake attachments — the marketing
//     page's content, none of which has a counterpart here.
// What stayed: the composer's proportions, the grid that moves the controls
// onto their own row once the draft wraps, the auto-growing textarea, the
// gliding highlight in the menu, and the tactile send button.
//
// The `/` commands are real, though — they are the questions people actually
// arrive with, and a first-run empty chat with no idea what to type is the
// single biggest reason an assistant goes unused.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "#/lib/utils.ts";

function Icon({
	children,
	size = 15,
	strokeWidth = 1.8,
	title,
}: {
	children: React.ReactNode;
	size?: number;
	strokeWidth?: number;
	title: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={strokeWidth}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<title>{title}</title>
			{children}
		</svg>
	);
}

export type SlashCommand = {
	name: string;
	description: string;
	prompt: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "/week",
		description: "What did I log this week?",
		prompt: "Summarise what I logged this week, grouped by project.",
	},
	{
		name: "/unfiled",
		description: "What still needs a project?",
		prompt:
			"Do I have any unfiled time this month? List it oldest first so I can attribute it.",
	},
	{
		name: "/log",
		description: "Log time",
		prompt: "Log ",
	},
	{
		name: "/month",
		description: "How is this month tracking?",
		prompt:
			"How many hours have I logged this month, and how does that compare to last month?",
	},
];

/** The trailing `/word` being typed, if any. */
const parseCommand = (draft: string) => {
	const match = /(^|\s)\/([\w-]*)$/.exec(draft);
	if (!match) return null;
	return {
		query: (match[2] ?? "").toLowerCase(),
		start: match.index + (match[1]?.length ?? 0),
	};
};

export function PromptBar({
	onSend,
	onStop,
	busy,
	disabled,
	placeholder = "Ask about your time, or log some…",
	autoFocus,
}: {
	onSend: (text: string) => void;
	onStop: () => void;
	busy: boolean;
	disabled?: boolean;
	placeholder?: string;
	autoFocus?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const [dismissed, setDismissed] = useState(false);
	const [active, setActive] = useState(0);
	const [engaged, setEngaged] = useState(false);
	const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(
		null,
	);

	const anchorRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const token = dismissed ? null : parseCommand(draft);
	const rows = token
		? SLASH_COMMANDS.filter((command) =>
				command.name.slice(1).startsWith(token.query),
			)
		: [];
	const menuOpen = Boolean(token);

	// Focus imperatively rather than through the `autofocus` attribute. Same
	// outcome — the composer is this page's single purpose, and landing anywhere
	// else costs a click on every visit — but the attribute focuses during
	// hydration, before the page has settled, which on a slow load steals focus
	// from wherever the reader had already moved.
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	// Reset the selection whenever the list underneath it changes, so the
	// highlight can't sit on row 3 of a list that now has two rows.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `menuOpen` is derived from `token`, and both stand for "the list underneath changed"
	useEffect(() => {
		setActive(0);
		setEngaged(false);
	}, [token?.query, menuOpen]);

	// A single highlight glides to the active row rather than each row toggling
	// its own background — the same gesture as the sidebar's active pill.
	useLayoutEffect(() => {
		const target = rowRefs.current[active];
		if (target)
			setRowBox({ top: target.offsetTop, height: target.offsetHeight });
	}, [active]);

	// Grow to a compact maximum, then scroll.
	//
	// The original also moved the controls onto their own row once the draft
	// wrapped, measuring the text against the inline space left by the model
	// picker. With the picker gone there is one 28px button beside the input, so
	// there is nothing to make room for and no second row to move to — the
	// measuring span and the width arithmetic went with it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: it re-measures the textarea, and `draft` is what changes its content height
	useLayoutEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "0px";
		const contentHeight = input.scrollHeight;
		input.style.height = `${Math.min(Math.max(contentHeight, 28), 160)}px`;
		input.style.overflowY = contentHeight > 160 ? "auto" : "hidden";
	}, [draft]);

	const pick = (command: SlashCommand) => {
		setDraft(
			token
				? `${draft.slice(0, token.start)}${command.prompt}`
				: command.prompt,
		);
		setDismissed(true);
		inputRef.current?.focus();
	};

	const canSend = draft.trim().length > 0 && !busy && !disabled;
	const send = () => {
		if (!canSend) return;
		onSend(draft.trim());
		setDraft("");
		setDismissed(false);
	};

	return (
		<div data-promptbar className="w-full">
			<div ref={anchorRef} className="relative">
				{menuOpen && rows.length > 0 && (
					<div
						// A real menu role, not decoration: the rows are reachable with
						// ArrowUp/Down and Enter from the textarea below, so a screen
						// reader that is told this is a menu describes what actually works.
						role="menu"
						aria-label="Commands"
						onMouseLeave={() => setEngaged(false)}
						className="assistant-motion absolute inset-x-0 bottom-full z-10 mb-2 rounded-[10px] bg-surface p-1 shadow-raised"
						style={{
							animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both",
							transformOrigin: "bottom center",
						}}
					>
						<span
							aria-hidden
							className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
							style={{
								top: rowBox?.top ?? 0,
								height: rowBox?.height ?? 0,
								opacity: rowBox && engaged ? 1 : 0,
								transition:
									"top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
							}}
						/>
						{rows.map((command, index) => (
							<button
								key={command.name}
								type="button"
								role="menuitem"
								ref={(element) => {
									rowRefs.current[index] = element;
								}}
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => {
									setActive(index);
									setEngaged(true);
								}}
								onClick={() => pick(command)}
								className="relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left"
							>
								<span className="shrink-0 text-[12.5px] font-medium text-ink">
									{command.name}
								</span>
								<span className="min-w-0 flex-1 truncate text-[12px] text-ink-3">
									{command.description}
								</span>
							</button>
						))}
					</div>
				)}

				{/* The composer floats over the transcript rather than sitting on a
				    ruled shelf under it (see the route), so it is shaped like the thing
				    it now is: a pill, lifted, with the page showing through it. The
				    radius is half the resting height, which is why a one-line draft
				    reads as an orb and a wrapped one settles into a rounded card
				    without the corners jumping.
				    `shadow-lift` is the tab bar's shadow, deliberately — the design
				    allows exactly one elevation, and a floating composer is the second
				    thing in the app entitled to it for the same reason the tab bar is:
				    content passes underneath. The translucent fill plus the blur is
				    what makes that pass legible instead of just overlapping. */}
				<div
					className={cn(
						"relative isolate flex flex-col gap-1.5 overflow-hidden rounded-[22px] border border-line p-2 shadow-lift",
						"bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] backdrop-blur-xl",
						"transition-[border-color] duration-150 focus-within:border-line-strong",
					)}
				>
					<div className="grid grid-cols-[minmax(0,1fr)_28px] items-end gap-x-1">
						<textarea
							ref={inputRef}
							rows={1}
							value={draft}
							disabled={disabled}
							onChange={(event) => {
								setDraft(event.target.value);
								setDismissed(false);
							}}
							onKeyDown={(event) => {
								if (menuOpen && rows.length > 0) {
									if (event.key === "ArrowDown" || event.key === "ArrowUp") {
										event.preventDefault();
										setEngaged(true);
										setActive(
											(current) =>
												(current +
													(event.key === "ArrowDown" ? 1 : rows.length - 1)) %
												rows.length,
										);
										return;
									}
									if (
										(event.key === "Enter" && !event.shiftKey) ||
										event.key === "Tab"
									) {
										event.preventDefault();
										const command = rows[active];
										if (command) pick(command);
										return;
									}
								}
								if (event.key === "Escape") {
									setDismissed(true);
									return;
								}
								if (
									event.key === "Enter" &&
									!event.shiftKey &&
									!event.nativeEvent.isComposing
								) {
									event.preventDefault();
									send();
								}
							}}
							placeholder={placeholder}
							aria-label="Ask the assistant"
							className={cn(
								"min-h-7 w-full min-w-0 resize-none bg-transparent px-1 py-[5px] text-[13px] leading-[18px] text-ink outline-none",
								"[overflow-wrap:anywhere] placeholder:text-ink-3 disabled:opacity-50",
							)}
						/>

						{/* One button, two jobs: it sends, and while a turn is in flight it
						    stops — the same affordance ChatGPT uses, and the only place a
						    stop control is ever wanted. */}
						<button
							type="button"
							aria-label={busy ? "Stop" : "Send"}
							disabled={busy ? false : !canSend}
							onClick={() => (busy ? onStop() : send())}
							className={cn(
								// Round, like the shell around it — a squircle inside a pill
								// reads as two different families of corner.
								"flex size-7 shrink-0 items-center justify-center rounded-full",
								"transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94]",
							)}
							style={{
								background:
									busy || canSend ? "var(--ink)" : "var(--line-strong)",
								color: busy || canSend ? "var(--surface)" : "var(--ink-2)",
							}}
						>
							{busy ? (
								<span className="size-2.5 rounded-[2px] bg-current" />
							) : (
								<Icon size={16} strokeWidth={2.4} title="Send">
									<path d="M12 19V5M5 12l7-7 7 7" />
								</Icon>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
