import { createFileRoute, redirect } from "@tanstack/react-router";

/** The section has no landing page of its own — it has entries. The first one
 *  is the destination until there is a second worth choosing between. */
export const Route = createFileRoute("/infrastructure/")({
	beforeLoad: () => {
		throw redirect({ to: "/infrastructure/admins" });
	},
});
