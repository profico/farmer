import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { useAccess } from "../../../src/api/capabilities";
import { useClients, useCreateProject } from "../../../src/api/projects";
import { ProjectFields } from "../../../src/projects/components/project-fields";
import {
	EMPTY_FORM,
	newProjectOf,
	type ProjectForm,
	validateForm,
} from "../../../src/projects/model";
import {
	ActionButton,
	EmptyState,
	ErrorBanner,
	ErrorState,
	Skeleton,
} from "../../../src/ui/components";
import { messageOf } from "../../../src/ui/errors";
import { Inset, Screen } from "../../../src/ui/screen";

/**
 * A new project, with the fields of the web's dialog. The person who
 * creates it becomes its PM, so the money fields of the type show. After
 * the save, the project's page opens in place of this screen.
 */
export default function NewProjectScreen() {
	const router = useRouter();
	const access = useAccess();
	const clients = useClients();
	const create = useCreateProject();
	const [form, setForm] = useState<ProjectForm>(EMPTY_FORM);
	const [tried, setTried] = useState(false);
	const errors = tried ? validateForm(form) : {};

	const submit = () => {
		setTried(true);
		if (Object.keys(validateForm(form)).length > 0) return;
		create.mutate(newProjectOf(form), {
			onSuccess: (project) =>
				router.replace({
					pathname: "/projects/[id]",
					params: { id: project.id },
				}),
		});
	};

	const content = () => {
		if (!access.canManageProjects) {
			return (
				<EmptyState
					icon="folder"
					title="New project"
					message="An admin, or a PM or team lead on a project, can create a project."
				/>
			);
		}
		if (clients.isPending) {
			return (
				<Inset>
					<Skeleton height={56} />
					<Skeleton height={56} />
					<Skeleton height={56} />
				</Inset>
			);
		}
		if (clients.isError) {
			return (
				<ErrorState
					error={clients.error}
					onRetry={() => void clients.refetch()}
				/>
			);
		}
		if (clients.data.length === 0) {
			return (
				<EmptyState
					icon="client"
					title="No clients yet"
					message="Every project belongs to a client. Create a client first, then come back to add a project."
					action={
						<ActionButton
							label="Go to Clients"
							onPress={() => router.push("/workspace/clients")}
						/>
					}
				/>
			);
		}
		return (
			<Inset>
				<ProjectFields
					form={form}
					onChange={setForm}
					errors={errors}
					clients={clients.data}
					showMoney
				/>
				{create.error ? (
					<ErrorBanner message={messageOf(create.error) ?? ""} />
				) : null}
				<View style={{ alignItems: "flex-start" }}>
					<ActionButton
						label={create.isPending ? "Creating" : "Create"}
						disabled={create.isPending}
						onPress={submit}
					/>
				</View>
			</Inset>
		);
	};

	return (
		<>
			<Stack.Screen options={{ title: "New project" }} />
			<Screen topInset={false}>{content()}</Screen>
		</>
	);
}
