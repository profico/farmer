import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip.tsx";

/** The meter shows from this share of the model's context. */
export const CONTEXT_METER_FROM = 0.7;

const kTokens = (n: number) =>
	n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

/** How full the chat is, as a share from 0 to 1. Null when it is unknown. */
export const contextShare = (
	used: number | null | undefined,
	limit: number | null | undefined,
) => (used && limit && limit > 0 ? used / limit : null);

export function ContextMeter({
	used,
	limit,
	onNewChat,
}: {
	used: number | null | undefined;
	limit: number | null | undefined;
	onNewChat: () => void;
}) {
	const share = contextShare(used, limit);
	if (share === null || !used || !limit || share < CONTEXT_METER_FROM) {
		return null;
	}
	const percent = Math.min(100, Math.round(share * 100));
	return (
		<div className="mb-2 flex items-center justify-end gap-2 text-xs text-mut">
			<TooltipProvider delay={150}>
				<Tooltip>
					<TooltipTrigger
						className="rounded-full outline-offset-2"
						aria-label={`This chat uses ${percent}% of the model's memory`}
					>
						{/* The native element carries the value. The ring is drawn
						    with a conic gradient under a mask. */}
						<progress
							value={percent}
							max={100}
							aria-label={`Chat memory used: ${percent}%`}
							className="block size-5 appearance-none rounded-full [&::-moz-progress-bar]:hidden [&::-webkit-progress-bar]:hidden [&::-webkit-progress-value]:hidden"
							style={{
								background: `conic-gradient(var(--acc) ${percent}%, var(--line) 0)`,
								mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2.5px))",
							}}
						/>
					</TooltipTrigger>
					<TooltipContent>
						<span>
							This chat uses {percent}% of the model's memory. Start a new chat
							for best results.
							<br />
							{kTokens(used)} of {kTokens(limit)} tokens
						</span>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<button
				type="button"
				onClick={onNewChat}
				className="rounded-control px-1.5 py-0.5 text-ink-2 transition-colors duration-(--dur-fast) hover:bg-hover hover:text-ink"
			>
				New chat
			</button>
		</div>
	);
}
