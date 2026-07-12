import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "#/components/ui/textarea.tsx";
import { CATEGORY_COLORS } from "#/lib/category-colors.ts";
import { managedEntryTypesQuery } from "#/queries/entry-types.ts";
import { createEntryType } from "#/server/entry-types.ts";

const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

const formSchema = z.object({
	name: z.string().min(1, "Name is required"),
	color: z.string().optional(),
	description: z.string().optional(),
});

export function CreateEntryTypeDialog({
	scope,
	projectId,
	triggerLabel = "+ New type",
}: {
	scope: "organization" | "project";
	projectId?: string;
	triggerLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	const queryClient = useQueryClient();

	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { name: "", color: DEFAULT_COLOR, description: "" },
	});

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof formSchema>) =>
			createEntryType({ data: { scope, projectId, ...data } }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: managedEntryTypesQuery().queryKey,
			});
			setOpen(false);
			form.reset({ name: "", color: DEFAULT_COLOR, description: "" });
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not create entry type");
		},
	});

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={
					<Button variant="outline" size="sm">
						{triggerLabel}
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>New entry type</DialogTitle>
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
										<Input placeholder="e.g. Client meeting" {...field} />
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
							name="description"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Description (optional)</FormLabel>
									<FormControl>
										<Textarea
											placeholder="What this type is for…"
											rows={2}
											{...field}
										/>
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
