import {
	DropdownMenuItem,
	ExposedDropdownMenu,
	ExposedDropdownMenuBox,
	Host,
	Text,
	TextField,
	type TextFieldRef,
} from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	menuAnchor,
	onVisibilityChanged,
} from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState } from "react";

import { useHostTheme } from "./host";
import type { MenuControlProps } from "./menu-control";

/**
 * The exposed dropdown menu of Material 3. This is the `Picker` of
 * `@expo/ui` for Android, with one change: the field can fill the width
 * of the form. The `Picker` gives no way to set the width of its field, so
 * it was as wide as a default text field, about half of a phone.
 */
export function MenuControl<T extends string>({
	options,
	value,
	onChange,
	enabled,
	fill,
}: MenuControlProps<T>) {
	const hostTheme = useHostTheme();
	const [expanded, setExpanded] = useState(false);
	const [visible, setVisible] = useState(false);
	const field = useRef<TextFieldRef>(null);
	const label = options.find((option) => option.value === value)?.label ?? "";

	// The field is read-only and not controlled: its text goes in when the
	// field is on screen, and again on each change.
	useEffect(() => {
		if (visible) field.current?.setText(label);
	}, [label, visible]);

	return (
		<Host
			matchContents={fill ? { vertical: true } : true}
			style={fill ? { alignSelf: "stretch" } : undefined}
			{...hostTheme}
		>
			<ExposedDropdownMenuBox
				expanded={expanded}
				onExpandedChange={enabled ? setExpanded : undefined}
			>
				<TextField
					ref={field}
					readOnly
					enabled={enabled}
					modifiers={[
						menuAnchor(),
						...(fill ? [fillMaxWidth()] : []),
						onVisibilityChanged(setVisible),
					]}
				/>
				<ExposedDropdownMenu
					expanded={expanded}
					onDismissRequest={() => setExpanded(false)}
				>
					{options.map((option) => (
						<DropdownMenuItem
							key={option.value}
							onClick={
								enabled
									? () => {
											onChange(option.value);
											setExpanded(false);
										}
									: undefined
							}
						>
							<DropdownMenuItem.Text>
								<Text>{option.label}</Text>
							</DropdownMenuItem.Text>
						</DropdownMenuItem>
					))}
				</ExposedDropdownMenu>
			</ExposedDropdownMenuBox>
		</Host>
	);
}
