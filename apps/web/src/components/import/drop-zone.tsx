import { UploadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { cn } from "#/lib/utils.ts";

/**
 * The Harvest exports go in here: dropped, or chosen with the file dialog.
 *
 * The file input itself covers the whole zone, transparent. A native file
 * input takes dropped files on its own and reports them as a change, so one
 * `onChange` serves both the drop and the click, and the keyboard reaches
 * the same control a pointer does.
 */
export function DropZone({
	onFiles,
	disabled,
	compact = false,
}: {
	onFiles: (files: File[]) => void;
	disabled?: boolean;
	/** After the first drop: one line, for adding a file that was missing. */
	compact?: boolean;
}) {
	const [over, setOver] = useState(false);

	return (
		<div
			className={cn(
				"relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center transition-colors duration-(--dur-fast) has-focus-visible:border-ring",
				compact ? "px-4 py-4" : "px-6 py-12",
				over ? "border-primary bg-primary/5" : "hover:bg-muted/50",
				disabled && "opacity-60",
			)}
		>
			<UploadSimpleIcon className="size-6 text-muted-foreground" />
			<span className="text-sm font-medium">
				{compact
					? "Drop another export here to add it"
					: "Drop the Harvest CSV exports here"}
			</span>
			{!compact && (
				<span className="max-w-[52ch] text-sm text-muted-foreground">
					Or click to choose them. Use the detailed time report, the people list
					(real email addresses) and the projects list (codes); the clients and
					tasks lists are optional. Only the time report is necessary.
				</span>
			)}
			<input
				type="file"
				multiple
				accept=".csv,text/csv"
				aria-label="Harvest CSV exports"
				className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
				disabled={disabled}
				onDragEnter={() => setOver(true)}
				onDragLeave={() => setOver(false)}
				onDrop={() => setOver(false)}
				onChange={(event) => {
					onFiles(Array.from(event.target.files ?? []));
					// The same file chosen again is a change too: the admin may
					// have exported it again under the same name.
					event.target.value = "";
				}}
			/>
		</div>
	);
}
