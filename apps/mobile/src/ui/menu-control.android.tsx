import {
	DropdownMenuItem,
	ExposedDropdownMenu,
	ExposedDropdownMenuBox,
	Host,
	Text,
	OutlinedTextField,
	type TextFieldRef,
} from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	menuAnchor,
	onVisibilityChanged,
} from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withSpring,
	withTiming,
} from "react-native-reanimated";

import { useHostTheme } from "./host";
import { Icon } from "./icon";
import type { MenuControlProps } from "./menu-control";
import { springOrFade, useMotionPreference } from "./motion";
import { usePalette } from "./theme";

/**
 * The exposed dropdown menu of Material 3, with an outlined field and a
 * floating label, as `Field` looks. The field can fill the width of the
 * form. The arrow is React Native, drawn over the field, so that it turns
 * with a spring when the menu opens.
 */
export function MenuControl<T extends string>({
	options,
	value,
	onChange,
	enabled,
	fill,
	label: fieldLabel,
}: MenuControlProps<T>) {
	const hostTheme = useHostTheme();
	const palette = usePalette();
	const { reduceMotion } = useMotionPreference();
	const turn = useSharedValue(0);
	const [expanded, setExpanded] = useState(false);
	const [visible, setVisible] = useState(false);
	const field = useRef<TextFieldRef>(null);
	const label = options.find((option) => option.value === value)?.label ?? "";

	// The field is read-only and not controlled: its text goes in when the
	// field is on screen, and again on each change.
	useEffect(() => {
		if (visible) field.current?.setText(label);
	}, [label, visible]);

	useEffect(() => {
		const target = expanded ? 1 : 0;
		const choice = springOrFade("fastSpatial", reduceMotion);
		turn.set(
			choice.reduced
				? withTiming(target, { duration: choice.fadeMs })
				: withSpring(target, choice.spring),
		);
	}, [expanded, reduceMotion, turn]);
	const arrow = useAnimatedStyle(() => ({
		transform: [{ rotate: `${turn.value * 180}deg` }],
	}));

	return (
		<View style={fill ? { alignSelf: "stretch" } : undefined}>
			<Host
				matchContents={fill ? { vertical: true } : true}
				style={fill ? { alignSelf: "stretch" } : undefined}
				{...hostTheme}
			>
				<ExposedDropdownMenuBox
					expanded={expanded}
					onExpandedChange={enabled ? setExpanded : undefined}
				>
					<OutlinedTextField
						ref={field}
						readOnly
						enabled={enabled}
						modifiers={[
							menuAnchor(),
							...(fill ? [fillMaxWidth()] : []),
							onVisibilityChanged(setVisible),
						]}
					>
						{fieldLabel ? (
							<OutlinedTextField.Label>
								<Text>{fieldLabel}</Text>
							</OutlinedTextField.Label>
						) : null}
					</OutlinedTextField>
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
			<Animated.View
				pointerEvents="none"
				style={[
					{ position: "absolute", right: 12, top: 0, bottom: 0 },
					{ justifyContent: "center" },
					arrow,
				]}
			>
				<Icon name="expand" size={24} color={palette.onSurfaceVariant} />
			</Animated.View>
		</View>
	);
}
