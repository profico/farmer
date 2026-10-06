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

/** The API version that added the routes for every screen of the app. */
export const FULL_API_VERSION = 2;

/**
 * The API version that added the helpers of the day ("Assemble my day", the
 * calendar meetings, the calendar notice and GitHub on an entry), the
 * project repositories, the image uploads, the organization policy, the
 * holiday switch and the routes of a person before a workspace
 * (invitations, import claims, a new workspace).
 */
export const V3_API_VERSION = 3;

export type ServerFeatures = {
	/** The Server has the routes of API version 3 (`V3_API_VERSION`). */
	setupApi: boolean;
	/** The Server stores images: a project icon or the organization's logo. */
	uploads: boolean;
	/** A person may make a workspace on this Server. */
	workspaceCreation: boolean;
};

/**
 * What the Server offers, from `/meta` only. It needs no workspace, so the
 * screen of a person without a workspace can read it. While `/meta` loads,
 * the Server counts as version 1, and nothing of version 3 shows.
 */
export const useServerFeatures = (): ServerFeatures => {
	const meta = useMeta();
	const setupApi = (meta.data?.apiVersion ?? 1) >= V3_API_VERSION;
	return {
		setupApi,
		uploads: setupApi && meta.data?.uploadsEnabled === true,
		workspaceCreation: setupApi && meta.data?.organizationCreation === true,
	};
};

export type Access = Capabilities & {
	/** False until `meta` and `whoami` are both read. */
	ready: boolean;
	/** The Server has the routes of API version 2: the "You" screens, the
	 *  other reports and the project settings. */
	fullApi: boolean;
	/** The Server has the routes of API version 3: the helpers of the day.
	 *  The same check as `setupApi`. */
	dayApi: boolean;
} & ServerFeatures;

/**
 * What the person may do in the current workspace, from `whoami`. A Server
 * before API version 2 lacks the routes of every screen after the first
 * ones, so it gives no capabilities, whatever `whoami` says. A section is
 * shown only when its capability is true; the route still checks it. The
 * screens of API version 3 also need `setupApi`.
 */
export const useAccess = (): Access => {
	const meta = useMeta();
	const whoami = useWhoami();
	const features = useServerFeatures();
	const fullApi = (meta.data?.apiVersion ?? 1) >= FULL_API_VERSION;
	const capabilities =
		fullApi && whoami.data ? whoami.data.capabilities : NO_CAPABILITIES;
	return {
		...capabilities,
		...features,
		ready: meta.data !== undefined && whoami.data !== undefined,
		fullApi,
		dayApi: features.setupApi,
	};
};

/** The assistant's settings. Any member may read them. */
export const useAssistantSettings = () => {
	const w = useWorkspace();
	const { fullApi } = useAccess();
	return useQuery({
		queryKey: [...scope(w), "assistant", "settings"],
		queryFn: () => w.client.getAssistantSettings(w.slug),
		enabled: fullApi,
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
