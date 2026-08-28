import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ColorPicker } from "#/components/color-picker.tsx";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "#/components/ui/form.tsx";
import { Input } from "#/components/ui/input.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import { CATEGORY_COLORS } from "#/lib/category-colors.ts";
import { projectsQuery } from "#/queries/projects.ts";
import { updateProject } from "#/server/projects.ts";

const DEFAULT_COLOR = CATEGORY_COLORS[0].dot;

const formSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(120),
	color: z.string(),
});

export type EditableProject = {
	id: string;
	name: string;
	color: string | null;
};

/**
 * The project's own fields — name and colour. The form only, so the dialog (the
 * small-screen path) and the detail panel's Edit tab are the same two inputs
 * rather than two drifting copies of them.
 *
 * `footer` is a render prop rather than fixed markup because the two hosts
 * close differently: the dialog wants Cancel + Save in a `DialogFooter`, and the
 * panel wants a single Save bar that only appears once something changed.
 */
export function ProjectEditForm({
	project,
	onSaved,
	footer,
	className,
}: {
	project: EditableProject | null;
	onSaved?: () => void;
	footer: (state: { pending: boolean; dirty: boolean }) => ReactNode;
	className?: string;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();
	const form = useForm<z.infer<typeof formSchema>>({
		resolver: zodResolver(formSchema),
		defaultValues: { name: "", color: DEFAULT_COLOR },
	});

	// One form serves every project, so the fields are re-seeded whenever the
	// selection changes rather than at mount. `reset` also clears dirty state,
	// which is what keeps the panel's Save bar from appearing on a fresh switch.
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
		onSuccess: async (_result, data) => {
			await queryClient.invalidateQueries({
				queryKey: projectsQuery(orgSlug).queryKey,
			});
			// Re-baseline to what was just saved. Without it the form stays dirty
			// against its old defaults and the panel's Save bar never goes away.
			reset(data);
			onSaved?.();
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not save the project");
		},
	});

	return (
		<Form {...form}>
			<form
				onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
				className={className ?? "grid gap-4"}
			>
				<FormField
					control={form.control}
					name="name"
					render={({ field }) => (
						<FormItem>
							<FormLabel>Name</FormLabel>
							<FormControl>
								<Input {...field} />
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
								<ColorPicker value={field.value} onChange={field.onChange} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
				{footer({
					pending: mutation.isPending,
					dirty: form.formState.isDirty,
				})}
			</form>
		</Form>
	);
}
