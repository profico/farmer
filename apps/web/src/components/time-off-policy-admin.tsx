import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table.tsx";
import { TablePagination } from "#/components/ui/table-pagination.tsx";
import { useTableSearch } from "#/lib/use-table-search.ts";
import {
	memberAllowancesQuery,
	timeOffPolicyQuery,
} from "#/queries/time-off-policy.ts";
import {
	setMemberAllowance,
	updateTimeOffPolicy,
} from "#/server/time-off-policy.ts";

const ALLOWANCES_PAGE_SIZE = 10;

function PolicyForm() {
	const { data: policy } = useSuspenseQuery(timeOffPolicyQuery());
	const queryClient = useQueryClient();

	const [defaultAllowanceDays, setDefault] = useState(
		String(policy.defaultAllowanceDays),
	);
	const [carryoverEnabled, setCarryover] = useState(policy.carryoverEnabled);
	const [carryoverMaxDays, setMax] = useState(
		policy.carryoverMaxDays === null ? "" : String(policy.carryoverMaxDays),
	);
	const [expiryMonth, setMonth] = useState(String(policy.carryoverExpiryMonth));
	const [expiryDay, setDay] = useState(String(policy.carryoverExpiryDay));

	const mutation = useMutation({
		mutationFn: () =>
			updateTimeOffPolicy({
				data: {
					defaultAllowanceDays: Number(defaultAllowanceDays),
					carryoverEnabled,
					carryoverMaxDays:
						carryoverMaxDays === "" ? null : Number(carryoverMaxDays),
					carryoverExpiryMonth: Number(expiryMonth),
					carryoverExpiryDay: Number(expiryDay),
				},
			}),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: timeOffPolicyQuery().queryKey,
				}),
				queryClient.invalidateQueries({ queryKey: ["time-off", "balance"] }),
				queryClient.invalidateQueries({
					queryKey: memberAllowancesQuery().queryKey,
				}),
			]);
			toast.success("Policy saved");
		},
		onError: (error) => toast.error(error.message ?? "Could not save policy"),
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				mutation.mutate();
			}}
			className="mt-4 grid max-w-xl gap-4"
		>
			<div className="grid gap-1.5">
				<Label>Default yearly allowance (days)</Label>
				<Input
					type="number"
					min={0}
					value={defaultAllowanceDays}
					onChange={(e) => setDefault(e.target.value)}
					className="w-32"
				/>
			</div>
			<div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
				<div>
					<p className="text-sm font-medium">
						Carry unused days into next year
					</p>
					<p className="text-2xs text-muted-foreground">
						Carried days are used before the new year's allowance.
					</p>
				</div>
				<Switch checked={carryoverEnabled} onCheckedChange={setCarryover} />
			</div>
			{carryoverEnabled && (
				<div className="grid gap-4 sm:grid-cols-3">
					<div className="grid gap-1.5">
						<Label>Max carried (blank = no cap)</Label>
						<Input
							type="number"
							min={0}
							value={carryoverMaxDays}
							onChange={(e) => setMax(e.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label>Expiry month</Label>
						<Input
							type="number"
							min={1}
							max={12}
							value={expiryMonth}
							onChange={(e) => setMonth(e.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label>Expiry day</Label>
						<Input
							type="number"
							min={1}
							max={31}
							value={expiryDay}
							onChange={(e) => setDay(e.target.value)}
						/>
					</div>
				</div>
			)}
			<div>
				<Button type="submit" disabled={mutation.isPending}>
					Save policy
				</Button>
			</div>
		</form>
	);
}

function MemberAllowancesTable() {
	const { data: allowances } = useSuspenseQuery(memberAllowancesQuery());
	const queryClient = useQueryClient();
	const [edits, setEdits] = useState<Record<string, string>>({});

	const {
		search,
		setSearch,
		paged,
		page,
		setPage,
		pageCount,
		total,
		from,
		to,
	} = useTableSearch(
		allowances,
		(a) => `${a.name} ${a.email}`,
		ALLOWANCES_PAGE_SIZE,
	);

	const mutation = useMutation({
		mutationFn: (vars: { userId: string; allowanceDays: number | null }) =>
			setMemberAllowance({ data: vars }),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: memberAllowancesQuery().queryKey,
				}),
				queryClient.invalidateQueries({ queryKey: ["time-off", "balance"] }),
			]);
		},
		onError: (error) =>
			toast.error(error.message ?? "Could not update allowance"),
	});

	return (
		<>
			{allowances.length > ALLOWANCES_PAGE_SIZE && (
				<div className="relative mt-4 max-w-xs">
					<Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search members…"
						className="pl-8"
					/>
				</div>
			)}
			<Table
				className="border-t [&_td:first-child]:pl-8 [&_td:last-child]:pr-8 [&_th:first-child]:pl-8 [&_th:last-child]:pr-8"
				containerClassName="-mx-4 mt-4 border-b sm:-mx-8"
			>
				<TableHeader>
					<TableRow>
						<TableHead>Member</TableHead>
						<TableHead>Effective</TableHead>
						<TableHead>Override</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{paged.length === 0 ? (
						<TableRow>
							<TableCell
								colSpan={4}
								className="py-8 text-center text-sm text-muted-foreground"
							>
								No members match your search.
							</TableCell>
						</TableRow>
					) : (
						paged.map((a) => {
							const editValue = edits[a.userId] ?? String(a.override ?? "");
							return (
								<TableRow key={a.userId}>
									<TableCell className="font-medium">
										{a.name}
										<span className="ml-2 text-2xs text-muted-foreground">
											{a.email}
										</span>
									</TableCell>
									<TableCell className="tnum">{a.effective}</TableCell>
									<TableCell>
										<Input
											type="number"
											min={0}
											placeholder="default"
											value={editValue}
											onChange={(e) =>
												setEdits((prev) => ({
													...prev,
													[a.userId]: e.target.value,
												}))
											}
											className="w-24"
										/>
									</TableCell>
									<TableCell className="flex justify-end gap-1">
										<Button
											size="sm"
											disabled={mutation.isPending}
											onClick={() =>
												mutation.mutate({
													userId: a.userId,
													allowanceDays:
														editValue === "" ? null : Number(editValue),
												})
											}
										>
											Save
										</Button>
										{a.override !== null && (
											<Button
												size="sm"
												variant="ghost"
												disabled={mutation.isPending}
												onClick={() => {
													setEdits((prev) => ({ ...prev, [a.userId]: "" }));
													mutation.mutate({
														userId: a.userId,
														allowanceDays: null,
													});
												}}
											>
												Reset
											</Button>
										)}
									</TableCell>
								</TableRow>
							);
						})
					)}
				</TableBody>
			</Table>
			<TablePagination
				page={page}
				pageCount={pageCount}
				total={total}
				from={from}
				to={to}
				onPageChange={setPage}
			/>
		</>
	);
}

export function TimeOffPolicyAdmin() {
	return (
		<div>
			<Separator className="mt-10" />
			<section className="mt-10">
				<h2 className="font-display text-xl">Vacation policy</h2>
				<PolicyForm />
			</section>

			<Separator className="mt-10" />
			<section className="mt-10">
				<h2 className="font-display text-xl">Member allowances</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Override the default for individual members, or reset to fall back to
					it.
				</p>
				<MemberAllowancesTable />
			</section>
		</div>
	);
}
