import { SectionStack } from "../../src/navigation/section-stack";

/** The chats list sits under any other screen, so Back from a new chat
 *  that was opened directly lands on the list. */
export const unstable_settings = { initialRouteName: "index" };

export default function AssistantLayout() {
	return <SectionStack />;
}
