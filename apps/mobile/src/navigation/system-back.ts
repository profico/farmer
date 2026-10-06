import { useNavigationContainerRef } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { BackGesture } from "../../modules/back-gesture";
import { holdCount, subscribeHolds, systemMayHandleBack } from "./back-holds";

/**
 * On Android, hands the back gesture to the system at a place where the app
 * would only exit (a tab root with no pushed screen), so Android plays the
 * back-to-home preview. Everywhere else the app keeps Back. The router
 * decides with the same `canGoBack` of the navigation container that Expo
 * Router's own `BackHandler` listener asks, so the two never disagree.
 *
 * A dialog or a bottom sheet is a window of its own and takes Back before
 * the activity does, so it needs no check here.
 */
export function useSystemBack(): void {
	const navigation = useNavigationContainerRef();
	useEffect(() => {
		const native = BackGesture;
		if (Platform.OS !== "android" || !native) return;
		const update = () => {
			// Before the navigator is ready, the app keeps Back.
			const canGoBack = navigation.isReady() ? navigation.canGoBack() : true;
			native.setSystemOwnsBack(systemMayHandleBack(canGoBack, holdCount()));
		};
		update();
		const stopState = navigation.addListener("state", update);
		const stopHolds = subscribeHolds(update);
		return () => {
			stopState();
			stopHolds();
		};
	}, [navigation]);
}
