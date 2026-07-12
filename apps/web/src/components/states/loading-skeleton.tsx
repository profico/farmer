import { Skeleton } from "#/components/ui/skeleton.tsx";

const ROW_WIDTHS = [70, 58, 46, 34, 62, 40] as const;

export function ListLoadingSkeleton({ rows = 4 }: { rows?: number }) {
	const widths = ROW_WIDTHS.slice(0, rows);
	return (
		<div>
			{widths.map((width) => (
				<div
					key={width}
					className="flex items-center gap-3 border-t px-3 py-3 first:border-t-0"
				>
					<Skeleton className="size-2.5 shrink-0 rounded-sm" />
					<Skeleton className="h-3 flex-1" style={{ maxWidth: `${width}%` }} />
					<Skeleton className="h-3 w-11 shrink-0" />
				</div>
			))}
		</div>
	);
}
