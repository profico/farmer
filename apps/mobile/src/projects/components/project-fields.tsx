import type { Client } from "@farmer/api-client";
import { View } from "react-native";

import { MenuPicker } from "../../reports/components/menu-picker";
import { Field, Text } from "../../ui/components";
import { usePalette } from "../../ui/theme";
import { SPACE } from "../../ui/type";
import {
	CODE_MAX_LENGTH,
	type FormErrors,
	NAME_MAX_LENGTH,
	PROJECT_TYPES,
	type ProjectForm,
	type ProjectType,
} from "../model";
import { ProjectMark } from "./project-mark";

/** The value of the client menu when no client is chosen yet. */
const NO_CLIENT = "";

/**
 * The fields of a project: the create form and the settings. The money
 * fields show only for the type that has them, and only when `showMoney`
 * is true: the server sends no money to a person who may not see it.
 */
export function ProjectFields({
	form,
	onChange,
	errors,
	clients,
	showMoney,
	iconIsUpload = false,
}: {
	form: ProjectForm;
	onChange: (form: ProjectForm) => void;
	errors: FormErrors;
	clients: Client[];
	showMoney: boolean;
	/** The project has an uploaded image, which the app cannot show or
	 *  change yet. */
	iconIsUpload?: boolean;
}) {
	const palette = usePalette();
	const set = (patch: Partial<ProjectForm>) => onChange({ ...form, ...patch });
	const type = PROJECT_TYPES.find((item) => item.value === form.type);
	const clientOptions = [
		...(form.clientId ? [] : [{ value: NO_CLIENT, label: "Pick a client" }]),
		...clients.map((client) => ({ value: client.id, label: client.name })),
	];

	return (
		<View style={{ gap: SPACE.l }}>
			<Field
				label="Name"
				value={form.name}
				onChangeText={(name) => set({ name })}
				maxLength={NAME_MAX_LENGTH}
				error={errors.name}
				autoCapitalize="words"
			/>
			<Field
				label="Code"
				value={form.code}
				onChangeText={(code) => set({ code })}
				placeholder="ACME"
				maxLength={CODE_MAX_LENGTH}
				autoCapitalize="characters"
				autoCorrect={false}
				hint="The name and code appear as [CODE] Name everywhere."
			/>
			<View style={{ gap: SPACE.xs }}>
				<MenuPicker
					label="Client"
					options={clientOptions}
					value={form.clientId}
					onChange={(clientId) => set({ clientId })}
				/>
				{errors.clientId ? (
					<Text variant="bodySmall" color={palette.error}>
						{errors.clientId}
					</Text>
				) : null}
			</View>
			<View style={{ gap: SPACE.xs }}>
				<MenuPicker<ProjectType>
					label="Type"
					options={PROJECT_TYPES}
					value={form.type}
					onChange={(next) => set({ type: next })}
				/>
				<Text variant="bodySmall" color={palette.onSurfaceVariant}>
					{type?.hint ?? ""}
				</Text>
			</View>
			<View
				style={{ flexDirection: "row", gap: SPACE.m, alignItems: "flex-start" }}
			>
				<View style={{ paddingTop: SPACE.l + SPACE.xs }}>
					<ProjectMark
						icon={iconIsUpload ? null : form.icon.trim() || null}
						name={form.name}
						size="large"
					/>
				</View>
				<View style={{ flex: 1 }}>
					<Field
						label="Icon"
						value={iconIsUpload ? "" : form.icon}
						onChangeText={(icon) => set({ icon })}
						placeholder="An emoji"
						maxLength={16}
						autoCorrect={false}
						hint={
							iconIsUpload
								? "An uploaded image. Type an emoji to put one in its place, or use the web to change the image."
								: "Optional. The first letter of the name stands in."
						}
					/>
				</View>
			</View>
			{showMoney && form.type === "fixed_scope" ? (
				<>
					<Field
						label="Budget, hours"
						value={form.budgetHours}
						onChangeText={(budgetHours) => set({ budgetHours })}
						placeholder="e.g. 400"
						keyboardType="decimal-pad"
						error={errors.budgetHours}
					/>
					<Field
						label="Budget, amount"
						value={form.budgetAmount}
						onChangeText={(budgetAmount) => set({ budgetAmount })}
						placeholder="e.g. 32000"
						keyboardType="decimal-pad"
						error={errors.budgetAmount}
						hint="Shown as context beside the hours. Nothing is computed from it."
					/>
				</>
			) : null}
			{showMoney && form.type === "hourly" ? (
				<Field
					label="Hourly price"
					value={form.hourlyPrice}
					onChangeText={(hourlyPrice) => set({ hourlyPrice })}
					placeholder="e.g. 85"
					keyboardType="decimal-pad"
					error={errors.hourlyPrice}
					hint="Visible to this project's PMs and admins only."
				/>
			) : null}
		</View>
	);
}
