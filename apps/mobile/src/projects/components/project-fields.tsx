import type { Client } from "@farmer/api-client";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";

import { FormCluster, FormPart } from "../../forms/form-cluster";
import { MenuPicker } from "../../reports/components/menu-picker";
import { ActionButton, Field, Text } from "../../ui/components";
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

const CODE_HINT = "The name and code appear as [CODE] Name everywhere.";
const BUDGET_HINT =
	"Shown as context beside the hours. Nothing is computed from it.";

/** iOS lists the controls as rows of one group, and shows the note of a
 *  row in the footer of the group. Android stacks the note under it. */
const noted = (row: ReactNode, note: ReactNode) =>
	Platform.OS === "ios" ? (
		row
	) : (
		<View style={{ gap: SPACE.xs }}>
			{row}
			{note}
		</View>
	);

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
	upload,
}: {
	form: ProjectForm;
	onChange: (form: ProjectForm) => void;
	errors: FormErrors;
	clients: Client[];
	showMoney: boolean;
	/** The icon is the path of an uploaded image. */
	iconIsUpload?: boolean;
	/** The Server stores images (`uploads`): the icon can be an uploaded
	 *  image. `onPress` lets the person choose one, and puts its path in
	 *  the form; Save stores it, as on the web. */
	upload?: { busy: boolean; onPress: () => void };
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
			<FormCluster>
				<FormPart
					footerError={Boolean(errors.name)}
					groupFooter={errors.name ?? CODE_HINT}
				>
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
						hint={CODE_HINT}
					/>
				</FormPart>
			</FormCluster>
			<FormCluster>
				<FormPart
					footerError={Boolean(errors.clientId)}
					groupFooter={errors.clientId ?? type?.hint}
				>
					{noted(
						<MenuPicker
							label="Client"
							row
							fill
							options={clientOptions}
							value={form.clientId}
							onChange={(clientId) => set({ clientId })}
						/>,
						errors.clientId ? (
							<Text variant="bodySmall" color={palette.error}>
								{errors.clientId}
							</Text>
						) : null,
					)}
					{noted(
						<MenuPicker<ProjectType>
							label="Type"
							row
							fill
							options={PROJECT_TYPES}
							value={form.type}
							onChange={(next) => set({ type: next })}
						/>,
						<Text variant="bodySmall" color={palette.onSurfaceVariant}>
							{type?.hint ?? ""}
						</Text>,
					)}
				</FormPart>
			</FormCluster>
			<View
				style={{ flexDirection: "row", gap: SPACE.m, alignItems: "flex-start" }}
			>
				<View
					style={{ paddingTop: Platform.OS === "ios" ? 0 : SPACE.l + SPACE.xs }}
				>
					<ProjectMark
						icon={form.icon.trim() || null}
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
								? "An uploaded image. Type an emoji to use it in place of the image."
								: upload
									? "Optional. An emoji or an image. The first letter of the name stands in."
									: "Optional. The first letter of the name stands in."
						}
					/>
				</View>
			</View>
			{upload || iconIsUpload ? (
				<View
					style={{
						flexDirection: "row",
						justifyContent: "flex-end",
						gap: SPACE.s,
					}}
				>
					{iconIsUpload ? (
						<ActionButton
							label="Remove image"
							variant="text"
							disabled={upload?.busy}
							onPress={() => set({ icon: "" })}
						/>
					) : null}
					{upload ? (
						<ActionButton
							label={upload.busy ? "Uploading" : "Upload image"}
							variant="outlined"
							disabled={upload.busy}
							onPress={upload.onPress}
						/>
					) : null}
				</View>
			) : null}
			{showMoney && form.type === "fixed_scope" ? (
				<FormCluster>
					<FormPart
						footerError={Boolean(errors.budgetHours ?? errors.budgetAmount)}
						groupFooter={
							errors.budgetHours ?? errors.budgetAmount ?? BUDGET_HINT
						}
					>
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
							hint={BUDGET_HINT}
						/>
					</FormPart>
				</FormCluster>
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
