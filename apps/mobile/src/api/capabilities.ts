import {
	type Capabilities,
	fetchMeta,
	NO_CAPABILITIES,
} from "@farmer/api-client";
import { useQuery } from "@tanstack/react-query";

import { useSignedIn } from "../session/session";
import { scope, useWhoami, useWorkspace } from "./queries";
import { transportFor } from "./transport";

const HOUR = 60 * 60_000;

/** `GET /meta` of the signed-in Server. It changes only with a deploy. */
export const useMeta = () => {
	const { origin } = useSignedIn();
	return useQuery({
		queryKey: ["farmer", origin, "meta"],
		queryFn: () => fetchMeta(transportFor(origin)),
		staleTime: HOUR,
	});
};

export type ServerFeatures = {
	/** The Server stores images: a project icon or the organization's logo. */
	uploads: boolean;
	/** A person may make a workspace on this Server. */
	workspaceCreation: boolean;
};

/**
 * What the Server offers, from `/meta` only. It needs no workspace, so the
 * screen of a person without a workspace can read it. While `/meta` loads,
 * no feature shows.
 */
export const useServerFeatures = (): ServerFeatures => {
	const meta = useMeta();
	return {
		uploads: meta.data?.uploadsEnabled === true,
		workspaceCreation: meta.data?.organizationCreation === true,
	};
};

export type Access = Capabilities & {
	/** False until `meta` and `whoami` are both read. */
	ready: boolean;
} & ServerFeatures;

/**
 * What the person may do in the current workspace, from `whoami`. A section
 * is shown only when its capability is true; the route still checks it.
 */
export const useAccess = (): Access => {
	const meta = useMeta();
	const whoami = useWhoami();
	const features = useServerFeatures();
	const capabilities = whoami.data ? whoami.data.capabilities : NO_CAPABILITIES;
	return {
		...capabilities,
		...features,
		ready: meta.data !== undefined && whoami.data !== undefined,
	};
};

/** The assistant's settings. Any member may read them. */
export const useAssistantSettings = () => {
	const w = useWorkspace();
	return useQuery({
		queryKey: [...scope(w), "assistant", "settings"],
		queryFn: () => w.client.getAssistantSettings(w.slug),
		staleTime: 5 * 60_000,
	});
};

/**
 * True when the chat can be used here: the deployment has the assistant
 * on, the workspace has a key, and no admin paused it. A failed read hides
 * the chat rather than showing an error in a menu.
 */
export const useAssistantAvailable = (): boolean => {
	const settings = useAssistantSettings();
	const data = settings.data;
	return Boolean(data?.available && data.configured && data.enabled);
};
