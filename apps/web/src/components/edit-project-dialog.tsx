import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
import { CATEGORY_COLORS } from "#/lib/category-colors.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { updateProject } from "#/server/projects.ts";

const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

const formSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(120),
	color: z.string(),
});

export function EditProjectDialog({
	project,
	onOpenChange,
}: {
	project: { id: string; name: string; color: string | null } | null;
	onOpenChange: (open: boolean) => void;
}) {
	const open = project !== null;
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { name: "", color: DEFAULT_COLOR },
	});

	// One dialog serves every row, so the fields are re-seeded each time it opens
	// on a different project rather than at mount.
	const { reset } = form;
	useEffect(() => {
		if (project) {
			reset({ name: project.name, color: project.color ?? DEFAULT_COLOR });
		}
	}, [project, reset]);

	const mutation = useMutation({
		mutationFn: (data: z.infer<typeof formSchema>) =>
			// A patch: name and colour only. Everything else the project carries —
			// client, type, budgets, task subset — is left untouched by the service.
			updateProject({
				data: {
					projectId: project?.id ?? "",
					name: data.name,
					color: data.color,
				},
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: projectsQuery().queryKey,
			});
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save the project");
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit project</DialogTitle>
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
						<DialogFooter>
							<Button
								type="button"
								variant="ghost"
								onClick={() => onOpenChange(false)}
								disabled={mutation.isPending}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={mutation.isPending}>
								{mutation.isPending ? "Saving…" : "Save"}
							</Button>
						</DialogFooter>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
