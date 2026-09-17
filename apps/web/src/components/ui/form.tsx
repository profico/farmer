import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import * as React from "react";
import {
	Controller,
	type ControllerProps,
	type FieldPath,
	type FieldValues,
	FormProvider,
	useFormContext,
	useFormState,
} from "react-hook-form";

import { Label } from "#/components/ui/label.tsx";
import { cn } from "#/lib/utils.ts";

const Form = FormProvider;

type FormFieldContextValue<
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
	name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>(
	// SAFETY: the standard react-hook-form context seed. Nothing reads this default
	// — `useFormField` throws if it is used outside a `<FormField>`, so the empty
	// object is unreachable rather than merely unlikely.
	{} as FormFieldContextValue,
);

const FormField = <
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
	...props
}: ControllerProps<TFieldValues, TName>) => {
	return (
		<FormFieldContext.Provider value={{ name: props.name }}>
			<Controller {...props} />
		</FormFieldContext.Provider>
	);
};

const useFormField = () => {
	const fieldContext = React.useContext(FormFieldContext);
	const itemContext = React.useContext(FormItemContext);
	const { getFieldState } = useFormContext();
	const formState = useFormState({ name: fieldContext.name });
	const fieldState = getFieldState(fieldContext.name, formState);

	if (!fieldContext) {
		throw new Error("useFormField should be used within <FormField>");
	}

	const { id } = itemContext;

	return {
		id,
		name: fieldContext.name,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
		...fieldState,
	};
};

type FormItemContextValue = {
	id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>(
	// SAFETY: as above — `useFormField` refuses to run outside a `<FormItem>`, so
	// this default is never the value anything reads.
	{} as FormItemContextValue,
);

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
	const id = React.useId();

	return (
		<FormItemContext.Provider value={{ id }}>
			{/* `content-start`: a field beside a taller one is stretched to the
			    row's height, and without it the grid shares that spare height
			    out between the label and the box — the label's text drops to the
			    middle of its row and the box slides down. With it the spare
			    height stays below the field, where nothing is drawn. */}
			<div
				data-slot="form-item"
				className={cn("grid content-start gap-1.5", className)}
				{...props}
			/>
		</FormItemContext.Provider>
	);
}

function FormLabel({
	className,
	required,
	children,
	...props
}: React.ComponentProps<typeof Label> & { required?: boolean }) {
	const { error, formItemId } = useFormField();

	return (
		<Label
			data-slot="form-label"
			data-error={!!error}
			className={cn("data-[error=true]:text-destructive", className)}
			htmlFor={formItemId}
			{...props}
		>
			{required ? (
				// The star takes the label's color: grey at rest, red with the label
				// once the field is wrong. A red star on every required field would
				// put red on a form before anything is wrong with it.
				<span className="inline-flex items-center gap-0.5">
					{children}
					<span aria-hidden="true">*</span>
				</span>
			) : (
				children
			)}
		</Label>
	);
}

function FormControl({
	children,
	...props
}: useRender.ComponentProps<"input"> & { children: React.ReactElement }) {
	const { error, formItemId, formDescriptionId, formMessageId } =
		useFormField();

	return useRender({
		defaultTagName: "input",
		render: children,
		state: { slot: "form-control" },
		props: mergeProps<"input">(
			{
				id: formItemId,
				"aria-describedby": !error
					? `${formDescriptionId}`
					: `${formDescriptionId} ${formMessageId}`,
				"aria-invalid": !!error,
			},
			props,
		),
	});
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
	const { formDescriptionId } = useFormField();

	return (
		<p
			data-slot="form-description"
			id={formDescriptionId}
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

/**
 * The field's error, drawn INSIDE its box rather than under it: at the end of
 * the line in an `InputGroup`, before the caret in a Select or Combobox
 * trigger, or in the bottom corner of a tall box the caller positions it in.
 * A message under the box made the field taller, which stretched the field
 * beside it and moved every field under a centred dialog; inside the box,
 * nothing grows. A `span`, because a trigger is a `<button>` and a `<p>` is
 * not allowed inside one.
 */
function FormMessage({ className, ...props }: React.ComponentProps<"span">) {
	const { error, formMessageId } = useFormField();
	const body = error ? String(error?.message ?? "") : props.children;

	if (!body) {
		return null;
	}

	return (
		<span
			data-slot="form-message"
			id={formMessageId}
			className={cn("text-xs whitespace-nowrap text-destructive", className)}
			{...props}
		>
			{body}
		</span>
	);
}

export {
	useFormField,
	Form,
	FormItem,
	FormLabel,
	FormControl,
	FormDescription,
	FormMessage,
	FormField,
};
