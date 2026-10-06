import { useRouter } from "expo-router";
import { useEffect } from "react";

/**
 * `farmer://auth-callback`, as the router sees it. The link carries a
 * session or a code, so this screen never reads it. During a sign-in, the system auth
 * session gives the link to `signInWithProvider`, which checks it against
 * the nonce of the flow (`src/session/auth-flow.ts`). On Android the router
 * also gets the link and opens this route, so it closes itself. A link that
 * arrives with no sign-in in progress does nothing (ADR 0005).
 */
export default function AuthCallbackScreen() {
	const router = useRouter();
	useEffect(() => {
		if (router.canGoBack()) router.back();
		else router.replace("/");
	}, [router]);
	return null;
}
