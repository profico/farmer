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
import { cn } from "#/lib/utils.ts";
import { availableEntryTypesQuery } from "#/queries/entry-types.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { recurringBlockRulesQuery } from "#/queries/recurring-block-rules.ts";
import { createRecurringBlockRule } from "#/server/recurring-block-rules.ts";

const NO_PROJECT = "__none__";
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]; // index 0=Sun..6=Sat

const formSchema = z.object({
	typeId: z.string().min(1, "Type is required"),
	projectId: z.string(),
	description: z.string(),
	daysOfWeek: z.array(z.number()).min(1, "Pick at least one day"),
	startTime: z.string().min(1, "Start time is required"),
	duration: z.string().min(1, "Duration is required"),
});

export function CreateRecurringBlockRuleDialog() {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();
	const { data: projects } = useSuspenseQuery(projectsQuery());
	const { data: availableTypes } = useSuspenseQuery(availableEntryTypesQuery());

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: {
			typeId: "",
			projectId: NO_PROJECT,
			description: "",
			daysOfWeek: [1, 2, 3, 4, 5],
			startTime: "12:00",
			duration: "30m",
		},
	});

	const projectId = form.watch("projectId");
	const daysOfWeek = form.watch("daysOfWeek");
	const selectedProject = projects.find((p) => p.id === projectId);
	const typeOptions = [
		...availableTypes,
		...(selectedProject?.entryTypes ?? []),
	];

	const toggleDay = (day: number) => {
		const current = form.getValues("daysOfWeek");
		form.setValue(
			"daysOfWeek",
			current.includes(day)
				? current.filter((d) => d !== day)
				: [...current, day].sort(),
			{ shouldValidate: true },
		);
	};

	const mutation = useMutation({
		mutationFn: (values: z.infer<typeof formSchema>) =>
			createRecurringBlockRule({
				data: {
					typeId: values.typeId,
					projectId:
						values.projectId === NO_PROJECT ? undefined : values.projectId,
					description: values.description || undefined,
					daysOfWeek: values.daysOfWeek,
					startTime: values.startTime,
					duration: values.duration,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: recurringBlockRulesQuery().queryKey,
			});
			setOpen(false);
			form.reset();
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not create recurring block");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={<Button size="sm">+ New recurring block</Button>}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New recurring block</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form
						onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
						className="grid gap-4"
					>
						<FormField
							control={form.control}
							name="typeId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Type</FormLabel>
									<Select
										value={field.value}
										onValueChange={field.onChange}
										items={typeOptions.map((t) => ({
											value: t.id,
											label: t.name,
										}))}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="Select a type" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											{typeOptions.map((t) => (
												<SelectItem key={t.id} value={t.id}>
													{t.name}
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
							name="projectId"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Project (optional)</FormLabel>
									<Select
										value={field.value}
										onValueChange={field.onChange}
										items={[
											{ value: NO_PROJECT, label: "No project" },
											...projects.map((p) => ({ value: p.id, label: p.name })),
										]}
									>
										<FormControl>
											<SelectTrigger className="w-full">
												<SelectValue placeholder="No project" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value={NO_PROJECT}>No project</SelectItem>
											{projects.map((p) => (
												<SelectItem key={p.id} value={p.id}>
													{p.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormItem>
							<FormLabel>Days</FormLabel>
							<div className="flex gap-1">
								{DAY_LABELS.map((label, day) => (
									<button
										// biome-ignore lint/suspicious/noArrayIndexKey: day is the stable weekday number (0-6), not an incidental index
										key={day}
										type="button"
										onClick={() => toggleDay(day)}
										className={cn(
											"size-8 rounded-full border text-sm font-medium",
											daysOfWeek.includes(day)
												? "border-primary bg-primary text-primary-foreground"
												: "border-input bg-background text-muted-foreground",
										)}
									>
										{label}
									</button>
								))}
							</div>
							{form.formState.errors.daysOfWeek && (
								<p className="text-sm text-destructive">
									{form.formState.errors.daysOfWeek.message}
								</p>
							)}
						</FormItem>
						<FormField
							control={form.control}
							name="startTime"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Start time</FormLabel>
									<FormControl>
										<Input type="time" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="duration"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Duration</FormLabel>
									<FormControl>
										<Input placeholder="1.5, 30m, or 1h30m" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="description"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Note (optional)</FormLabel>
									<FormControl>
										<Input {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
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
