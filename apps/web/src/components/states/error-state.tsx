import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";

export function ErrorState({
	title = "Couldn't load this",
	description = "Something went wrong on our end. Check your connection and try again.",
	onRetry,
}: {
	title?: string;
	description?: string;
	onRetry?: () => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center px-6 py-10 text-center">
			<span className="flex size-13 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
				<AlertTriangle className="size-6" />
			</span>
			<p className="mt-4 text-[15px] font-semibold">{title}</p>
			<p className="mt-1.5 max-w-[240px] text-sm leading-relaxed text-muted-foreground">
				{description}
			</p>
			{onRetry && (
				<Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
					<RefreshCw className="size-3.5" />
					Retry
				</Button>
			)}
		</div>
	);
}
