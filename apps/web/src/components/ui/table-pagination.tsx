import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";

// Footer for a client-paginated table. Renders nothing when everything fits on
// a single page, so callers can drop it in unconditionally.
export function TablePagination({
	page,
	pageCount,
	total,
	from,
	to,
	onPageChange,
}: {
	page: number;
	pageCount: number;
	total: number;
	from: number;
	to: number;
	onPageChange: (page: number) => void;
}) {
	if (pageCount <= 1) return null;

	return (
		<div className="mt-3 flex items-center justify-between gap-4 text-xs text-muted-foreground">
			<span>
				{from}–{to} of {total}
			</span>
			<div className="flex items-center gap-2">
				<Button
					variant="outline"
					size="icon-sm"
					disabled={page === 1}
					onClick={() => onPageChange(page - 1)}
					aria-label="Previous page"
				>
					<ChevronLeftIcon />
				</Button>
				<span>
					Page {page} of {pageCount}
				</span>
				<Button
					variant="outline"
					size="icon-sm"
					disabled={page === pageCount}
					onClick={() => onPageChange(page + 1)}
					aria-label="Next page"
				>
					<ChevronRightIcon />
				</Button>
			</div>
		</div>
	);
}
