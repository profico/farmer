import { createProjectInput } from "@farmer/core/schema";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ColorPicker } from "#/components/color-picker.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { CATEGORY_COLORS } from "#/lib/category-colors.ts";
import { clientsQuery } from "#/queries/clients.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { createProject } from "#/server/projects.ts";

const NO_CLIENT = "__none__";
const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

// Built from the individual field schemas (rather than .pick()) so `billable`
// doesn't carry its z.infer/z.input mismatch through to zodResolver — the
// default is applied via the form's defaultValues instead.
const formSchema = z.object({
	name: createProjectInput.shape.name,
	firstTaskName: createProjectInput.shape.firstTaskName,
	color: createProjectInput.shape.color,
	clientId: createProjectInput.shape.clientId,
	billable: z.boolean(),
	billableRate: createProjectInput.shape.billableRate,
	// Kept as a plain string in the form (not the server's z.coerce.number())
	// to avoid the same z.infer/z.input mismatch noted above for `billable` —
	// the server's createProjectInput coerces it on submit either way.
	budgetHours: z.string().optional(),
	budgetAmount: createProjectInput.shape.budgetAmount,
});

export function CreateProjectDialog() {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const { data: clients } = useSuspenseQuery(clientsQuery());
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			name: "",
			firstTaskName: "",
			color: DEFAULT_COLOR,
			clientId: undefined,
			billable: true,
			billableRate: "",
			budgetHours: "",
			budgetAmount: "",
		},
	});

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof formSchema>) =>
			createProject({
				data: {
					...data,
					clientId: data.clientId === NO_CLIENT ? undefined : data.clientId,
					billableRate: data.billableRate || undefined,
					budgetHours: data.budgetHours || undefined,
					budgetAmount: data.budgetAmount || undefined,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectsQuery().queryKey,
			});
			setOpen(false);
			form.reset({
				name: "",
				firstTaskName: "",
				color: DEFAULT_COLOR,
				clientId: undefined,
				billable: true,
				billableRate: "",
				budgetHours: "",
				budgetAmount: "",
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not create project");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger render={<Button>+ New project</Button>} />
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create project</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
						className="grid gap-4"
					>
						<FormField
							control={form.control}
							name="name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Name</FormLabel>
									<FormControl>
										<Input autoFocus {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="color"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Color</FormLabel>
									<FormControl>
										<ColorPicker
											value={field.value}
											onChange={field.onChange}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="clientId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Client (optional)</FormLabel>
									<Select
										value={field.value ?? NO_CLIENT}
										onValueChange={field.onChange}
										disabled={clients.length === 0}
										items={[
											{ value: NO_CLIENT, label: "No client" },
											...clients.map((c) => ({ value: c.id, label: c.name })),
										]}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue
													placeholder={
														clients.length === 0
															? "No clients yet"
															: "No client"
													}
												/>
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value={NO_CLIENT}>No client</SelectItem>
											{clients.map((c) => (
												<SelectItem key={c.id} value={c.id}>
													{c.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="firstTaskName"
							render={({ field }) => (
								<FormItem>
									<FormLabel>First task (optional)</FormLabel>
									<FormControl>
										<Input {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<div className="flex items-center justify-between border-t pt-3.5">
							<div>
								<span className="text-sm font-semibold">Billable</span>
								<p className="text-xs text-muted-foreground">
									New blocks start marked billable
								</p>
							</div>
							<FormField
								control={form.control}
								name="billable"
								render={({ field }) => (
									<Switch
										checked={field.value}
										onCheckedChange={field.onChange}
									/>
								)}
							/>
						</div>
						<div className="grid grid-cols-2 gap-4 border-t pt-3.5">
							<FormField
								control={form.control}
								name="billableRate"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Rate / hour (optional)</FormLabel>
										<FormControl>
											<Input
												inputMode="decimal"
												placeholder="0.00"
												{...field}
												value={field.value ?? ""}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="budgetHours"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Budget, hours (optional)</FormLabel>
										<FormControl>
											<Input
												inputMode="decimal"
												placeholder="e.g. 100"
												{...field}
												value={field.value ?? ""}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="budgetAmount"
								render={({ field }) => (
									<FormItem className="col-span-2">
										<FormLabel>Budget, amount (optional)</FormLabel>
										<FormControl>
											<Input
												inputMode="decimal"
												placeholder="e.g. 5000"
												{...field}
												value={field.value ?? ""}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<DialogFooter>
							<Button type="submit" disabled={mutation.isPending}>
								Create
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
