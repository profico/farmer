import type * as React from "react";

import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * A one-line box holding an input and, at its end, the field's error message —
 * shadcn's input group, cut down to what the forms use. The box draws the
 * border, hover, focus and invalid states the bare `Input` draws for itself, so
 * the message sits inside the same outline as the value and the value narrows
 * to make room. The box never grows, so an error never moves the form.
 *
 *     <InputGroup>
 *       <FormControl>
 *         <InputGroupInput {...field} />
 *       </FormControl>
 *       <FormMessage />
 *     </InputGroup>
 */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="input-group"
			className={cn(
				"flex h-8 w-full min-w-0 items-center rounded-lg border border-input transition-[border-color,box-shadow] duration-(--dur-base)",
				"hover:not-has-[input:focus-visible]:not-has-[input:disabled]:not-has-[input[aria-invalid=true]]:border-muted-foreground/60",
				"has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/16",
				"has-[input[aria-invalid=true]]:border-destructive has-[input[aria-invalid=true]]:ring-3 has-[input[aria-invalid=true]]:ring-destructive/20",
				"*:data-[slot=form-message]:shrink-0 *:data-[slot=form-message]:pe-2.5",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupInput({
	className,
	...props
}: React.ComponentProps<typeof Input>) {
	return (
		<Input
			data-slot="input-group-control"
			className={cn(
				"h-full flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0 aria-invalid:ring-0",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupInput };
