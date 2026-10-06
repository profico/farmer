import { type FarmerClient, timerStateSchema } from "@farmer/api-client";
import {
	type QueryClient,
	type QueryKey,
	useQueryClient,
} from "@tanstack/react-query";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { type Href, router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { z } from "zod";

import { LiveActivity } from "../../modules/live-activity";
import { START_TIMER_KEY } from "../api/queries";
import { useSession } from "../session/session";
import { appTargetOf, isSurfaceStop, localAlertData } from "./payload";
import { onTimerPush } from "./receive";
import {
	type PushSession,
	reportLiveActivityToken,
	reportPushToStartToken,
	syncPush,
	teardownPush,
} from "./registration";
import { KEYS, readItem, writeItem } from "./storage";
import {
	askForTimerNotifications,
	needsDeniedHint,
	type PermissionApi,
	hideDeniedHint,
	showDeniedHint,
} from "./timer-permission";
import {
	clearTimerSurface,
	shareCredential,
	showTimerSurface,
	surfaceOfTimer,
} from "./timer-surface";

/**
 * Native push and the timer surfaces, for the signed-in session. It draws
 * nothing. The root layout mounts it once, inside the query cache.
 *
 * - On each foreground: register for push (when the Server uses a relay),
 *   read the timer, and show or clear the timer surface.
 * - Each change of the cached timer (a start, a pause, a confirm in the app)
 *   updates the surface at once.
 * - Each start in the app asks for the notification permission while it is
 *   not granted and the system can ask (`timer-permission.ts`). After a
 *   grant the surface shows at once. After a refusal the timer card shows a
 *   hint one time (Android).
 * - A tap on a notification opens the screen of its `url`.
 * - Stop on a surface opens the stop sheet. The sheet must find the clock
 *   held, in the workspace that is open (ADR 0003), so this holds it first.
 * - On sign-out, the relay registration and the shared credential go.
 */

const isTimerKey = (key: QueryKey) =>
	key.length === 4 && key[0] === "farmer" && key[3] === "timer";

const isStartKey = (key: readonly unknown[] | undefined) =>
	key !== undefined &&
	key.length === START_TIMER_KEY.length &&
	START_TIMER_KEY.every((part, index) => key[index] === part);

/** The system permission, through expo-notifications. */
const notificationPermission: PermissionApi = {
	get: () => Notifications.getPermissionsAsync(),
	request: () =>
		Notifications.requestPermissionsAsync({
			ios: { allowAlert: true, allowBadge: false, allowSound: true },
		}),
};

/** Show the surface of the timer that the cache holds now. The figure is
 *  anchored at the time of the read, not at the end of a dialog. */
const showCachedTimer = (queryClient: QueryClient) => {
	const latest = queryClient
		.getQueryCache()
		.findAll({ predicate: (query) => isTimerKey(query.queryKey) })
		.sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)[0];
	if (!latest) return;
	const parsed = timerStateSchema.safeParse(latest.state.data);
	const timer = parsed.success ? parsed.data.timer : null;
	const surface = timer
		? surfaceOfTimer(timer, latest.state.dataUpdatedAt)
		: null;
	if (surface) showTimerSurface(surface);
};

/** Read the timer, and set it in the cache of its workspace. */
const readTimer = async (
	client: FarmerClient,
	origin: string,
	workspace: string,
	queryClient: QueryClient,
) => {
	const state = await client.timer(workspace);
	queryClient.setQueryData(["farmer", origin, workspace, "timer"], state);
	return state.timer;
};

/** The iOS notification of a remote alert: the Notification Service
 *  Extension writes the opened `url` here. */
const remoteAlertData = z.object({ farmerUrl: z.string() });

export function PushBridge() {
	const { state, setWorkspace } = useSession();
	const queryClient = useQueryClient();
	const signedIn = state.status === "signed_in";
	const origin = signedIn ? state.session.origin : null;
	const token = signedIn ? state.session.token : null;
	const workspace = signedIn ? state.session.workspace : null;
	const client = signedIn ? state.client : null;

	// The latest values, for listeners that live longer than one render.
	const live = useRef({ client, origin, token, workspace, setWorkspace });
	useEffect(() => {
		live.current = { client, origin, token, workspace, setWorkspace };
	});

	// Sign-out: the session went from signed in to signed out.
	const wasSignedIn = useRef(false);
	useEffect(() => {
		if (wasSignedIn.current && state.status === "signed_out") {
			clearTimerSurface();
			void teardownPush();
		}
		if (state.status !== "loading") wasSignedIn.current = signedIn;
	}, [state.status, signedIn]);

	// Each foreground: register, share the credential, read the timer.
	useEffect(() => {
		if (!origin || !token || !client) return;
		const session: PushSession = { origin, token };
		const refresh = () => {
			void shareCredential(origin, token);
			void syncPush(session);
			// The person may have allowed notifications in the settings.
			void notificationPermission
				.get()
				.then((permission) => {
					if (permission.granted) hideDeniedHint();
				})
				.catch(() => undefined);
			const slug = live.current.workspace;
			if (!slug) return;
			readTimer(client, origin, slug, queryClient)
				.then((timer) => {
					// The cache subscription below shows the surface. A timer in
					// no workspace at all clears it.
					if (!timer) clearTimerSurface();
				})
				.catch(() => undefined);
		};
		refresh();
		const subscription = AppState.addEventListener("change", (status) => {
			if (status === "active") refresh();
		});
		return () => subscription.remove();
	}, [origin, token, client, queryClient]);

	// Each change of a cached timer updates the surface.
	useEffect(() => {
		return queryClient.getQueryCache().subscribe((event) => {
			if (event.type !== "updated" || event.action.type !== "success") return;
			if (!isTimerKey(event.query.queryKey)) return;
			const parsed = timerStateSchema.safeParse(event.query.state.data);
			if (!parsed.success) return;
			const timer = parsed.data.timer;
			const surface = timer
				? surfaceOfTimer(timer, event.query.state.dataUpdatedAt)
				: null;
			if (surface) showTimerSurface(surface);
			else clearTimerSurface();
		});
	}, [queryClient]);

	// Each start in the app: ask for the permission that the surface needs.
	// The start sets the cached timer before this runs, so the subscription
	// above already tried to show the surface, without the permission.
	useEffect(() => {
		return queryClient.getMutationCache().subscribe((event) => {
			if (event.type !== "updated" || event.action.type !== "success") return;
			if (!isStartKey(event.mutation.options.mutationKey)) return;
			void askForTimerNotifications(notificationPermission).then(
				async (result) => {
					if (result.granted) {
						showCachedTimer(queryClient);
						const { origin: o, token: t } = live.current;
						if (result.asked && o && t) void syncPush({ origin: o, token: t });
						return;
					}
					if (Platform.OS !== "android") return;
					const shown = (await readItem(KEYS.deniedHintShown)) !== null;
					if (!needsDeniedHint(result, shown)) return;
					await writeItem(KEYS.deniedHintShown, "1");
					showDeniedHint();
				},
			);
		});
	}, [queryClient]);

	// A timer push (Android) in the foreground: read the timer again, so the
	// Time tab shows the change that the web or the CLI made.
	useEffect(
		() =>
			onTimerPush(() => {
				void queryClient.invalidateQueries({
					predicate: (query) => isTimerKey(query.queryKey),
				});
			}),
		[queryClient],
	);

	// A tap on a notification. On a cold start the tap that opened the app
	// is read once the session is ready, and only once.
	const lastResponseRead = useRef(false);
	useEffect(() => {
		if (!signedIn) return;
		const open = (response: Notifications.NotificationResponse) => {
			const data = response.notification.request.content.data;
			const local = localAlertData.safeParse(data);
			const remote = remoteAlertData.safeParse(data);
			const target = local.success
				? { path: local.data.path, workspace: local.data.workspace }
				: remote.success
					? appTargetOf(remote.data.farmerUrl)
					: null;
			if (!target) return;
			void openTarget(target.path, target.workspace);
		};
		const openTarget = async (path: string, slug: string | null) => {
			const { client: c, workspace: current } = live.current;
			if (!c) return;
			if (slug && slug !== current) {
				// Only a workspace the person is in: a link must not open an
				// empty screen.
				const me = await c.me().catch(() => null);
				if (me?.organizations.some((org) => org.slug === slug)) {
					await live.current.setWorkspace(slug);
				}
			}
			// SAFETY: `path` comes from `appTargetOf`, which returns only
			// routes that exist in `app/`.
			router.push(path as Href);
		};
		if (!lastResponseRead.current) {
			lastResponseRead.current = true;
			void Notifications.getLastNotificationResponseAsync().then((response) => {
				if (response) open(response);
			});
		}
		const subscription =
			Notifications.addNotificationResponseReceivedListener(open);
		return () => subscription.remove();
	}, [signedIn]);

	// Stop on a timer surface: hold the clock, in the timer's workspace,
	// before the stop sheet reads it. On a cold start the link that opened
	// the app is read once the session is ready.
	const initialUrlRead = useRef(false);
	useEffect(() => {
		if (!signedIn) return;
		const hold = async (url: string | null) => {
			if (!url) return;
			if (!isSurfaceStop(url)) return;
			const { client: c, origin: o, workspace: current } = live.current;
			if (!c || !o || !current) return;
			try {
				const timer = await readTimer(c, o, current, queryClient);
				if (!timer || timer.droppedAt) return;
				const slug = timer.organization.slug;
				const held = timer.paused ? { timer } : await c.pauseTimer(slug);
				queryClient.setQueryData(["farmer", o, slug, "timer"], held);
				if (slug !== current) await live.current.setWorkspace(slug);
			} catch {
				// The sheet reads the timer itself and says what it finds.
			}
		};
		if (!initialUrlRead.current) {
			initialUrlRead.current = true;
			void Linking.getInitialURL().then(hold);
		}
		const subscription = Linking.addEventListener("url", (event) => {
			void hold(event.url);
		});
		return () => subscription.remove();
	}, [queryClient, signedIn]);

	// iOS: the Live Activity's tokens.
	useEffect(() => {
		if (Platform.OS !== "ios" || !LiveActivity) return;
		const activity = LiveActivity.addListener(
			"onActivityPushToken",
			(event) => {
				const { origin: o, token: t } = live.current;
				if (o && t) {
					void reportLiveActivityToken(
						{ origin: o, token: t },
						{ liveActivityToken: event.token },
					);
				}
			},
		);
		const start = LiveActivity.addListener("onPushToStartToken", (event) => {
			void reportPushToStartToken(event.token);
		});
		return () => {
			activity.remove();
			start.remove();
		};
	}, []);

	// A new native push token (FCM rotates them): register again.
	useEffect(() => {
		const subscription = Notifications.addPushTokenListener(() => {
			const { origin: o, token: t } = live.current;
			if (o && t) void syncPush({ origin: o, token: t });
		});
		return () => subscription.remove();
	}, []);

	return null;
}
