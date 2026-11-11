/** One thing the user said. Rendered from the transcript, and — for the turn in
 *  flight — from the text the composer just sent. */
export function UserMessage({ text }: { text: string }) {
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] rounded-card bg-inset px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
				{text}
			</div>
		</div>
	);
}
