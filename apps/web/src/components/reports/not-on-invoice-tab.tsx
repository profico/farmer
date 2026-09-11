import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { PersonCell } from "#/components/person-avatar.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NoMatchesRow, SearchInput } from "#/components/ui/search-input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { matchesSearch } from "#/lib/search.ts";
import { notOnInvoiceReportQuery } from "#/queries/not-on-invoice.ts";
import { setNotOnInvoiceStatus } from "#/server/not-on-invoice.ts";

// PRD 6.7 — the monthly note to the CEO. The system drafts the list of Billable
// people with zero Final hours on client work; the Admin supplies the reason.
export function NotOnInvoiceTab({
	year,
	month,
}: {
	year: number;
	month: number;
}) {
	const orgSlug = useOrgSlug();
	const { data } = useSuspenseQuery(
		notOnInvoiceReportQuery(orgSlug, { year, month }),
	);
	const [query, setQuery] = useState("");
	const filteredRows = data.rows.filter((row) =>
		matchesSearch(query, [row.name]),
	);

	if (data.finalizedCloseCount === 0) {
		return (
			<div className="border-t pt-6">
				<p className="h2">Nothing to draft yet</p>
				<p className="lede mt-2">
					No close has been finalized for this month, so everyone would show as
					un-invoiced. Finalize the month first.
				</p>
			</div>
		);
	}

	return (
		<>
			<p className="lede max-w-[68ch]">
				Billable people with zero Final hours on non-internal projects. Pick a
				reason so next month's list is comparable to this one.
			</p>
			{data.rows.length === 0 ? (
				<p className="mt-6 border-t pt-6 text-base text-muted-foreground">
					Everyone billable landed on an invoice this month.
				</p>
			) : (
				<>
					<SearchInput
						value={query}
						onValueChange={setQuery}
						className="mt-6 w-full sm:w-56"
					/>
					<Table containerClassName="mt-3">
						<TableHeader>
							<TableRow>
								<TableHead>Person</TableHead>
								<TableHead className="w-56">Reason</TableHead>
								<TableHead>Comment</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{filteredRows.length === 0 ? (
								<NoMatchesRow colSpan={3} />
							) : (
								filteredRows.map((row) => (
									<NotOnInvoiceRow
										key={row.userId}
										year={year}
										month={month}
										row={row}
										statusOptions={data.statusOptions}
									/>
								))
							)}
						</TableBody>
					</Table>
				</>
			)}
		</>
	);
}

const NO_STATUS = "__none__";

function NotOnInvoiceRow({
	year,
	month,
	row,
	statusOptions,
}: {
	year: number;
	month: number;
	row: {
		userId: string;
		name: string;
		statusOptionId: string | null;
		comment: string | null;
	};
	statusOptions: { id: string; label: string }[];
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const [comment, setComment] = useState(row.comment ?? "");

	const save = useMutation({
		mutationFn: (input: {
			statusOptionId: string | null;
			comment: string | null;
		}) =>
			setNotOnInvoiceStatus({
				data: { year, month, userId: row.userId, ...input },
			}),
		onSuccess: () =>
			queryClient.invalidateQueries({
				queryKey: notOnInvoiceReportQuery(orgSlug, { year, month }).queryKey,
			}),
		onError: (error) => {
			toast.error(error.message ?? "Could not save");
			setComment(row.comment ?? "");
		},
	});

	// Base UI's Select needs `items` to resolve a value to its label.
	const items = [
		{ value: NO_STATUS, label: "—" },
		...statusOptions.map((o) => ({ value: o.id, label: o.label })),
	];

	return (
		<TableRow>
			<TableCell>
				<PersonCell userId={row.userId} name={row.name} />
			</TableCell>
			<TableCell>
				<Select
					items={items}
					value={row.statusOptionId ?? NO_STATUS}
					onValueChange={(value: string | null) =>
						save.mutate({
							statusOptionId:
								value == null || value === NO_STATUS ? null : value,
							comment: row.comment,
						})
					}
				>
					<SelectTrigger className="h-8 w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</TableCell>
			<TableCell>
				<Input
					className="h-8"
					placeholder="Optional note"
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					onBlur={() => {
						if (comment === (row.comment ?? "")) return;
						save.mutate({
							statusOptionId: row.statusOptionId,
							comment: comment.trim() === "" ? null : comment.trim(),
						});
					}}
				/>
			</TableCell>
		</TableRow>
	);
}
