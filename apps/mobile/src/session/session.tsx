import { FarmerClient } from "@farmer/api-client";
import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";

import { transportFor } from "../api/transport";
import { teardownPush, unregisterDevice } from "../push/registration";
import { revokesOnSignOut } from "./credential";
import { wipeAfterReinstall } from "./first-launch";
import {
	readSession,
	type StoredSession,
	wipeSession,
	writeSession,
} from "./storage";

/** The longest time that a sign-out waits for the push teardown. */
const TEARDOWN_WAIT_MS = 3_000;

type Active = { session: StoredSession; client: FarmerClient };

type SessionState =
	| { status: "loading" }
	| {
			status: "signed_out";
			lastOrigin: string | null;
			/** The session that just ended. A screen behind the sign-in can
			 *  render once more before the guard removes it, and reads this. */
			previous: Active | null;
	  }
	| ({ status: "signed_in" } & Active);

export type SessionValue = {
	state: SessionState;
	signIn: (origin: string, token: string) => Promise<void>;
	/** Revokes a session token on the server, then forgets it here. A pasted
	 *  API token is only forgotten: other clients can use it. */
	signOut: () => Promise<void>;
	/** Forgets the token here only: the server already refused it. */
	forget: () => Promise<void>;
	setWorkspace: (slug: string) => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

const signedIn = (session: StoredSession): SessionState => ({
	status: "signed_in",
	session,
	client: new FarmerClient(transportFor(session.origin), session.token),
});

export function SessionProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<SessionState>({ status: "loading" });

	useEffect(() => {
		let live = true;
		// iOS: the Keychain items of an earlier install go before the first
		// read, so a new install does not sign in as that install's person.
		wipeAfterReinstall()
			.then(readSession)
			.then((stored) => {
				if (!live) return;
				setState(
					stored
						? signedIn(stored)
						: { status: "signed_out", lastOrigin: null, previous: null },
				);
			})
			.catch(() => {
				if (live) {
					setState({ status: "signed_out", lastOrigin: null, previous: null });
				}
			});
		return () => {
			live = false;
		};
	}, []);

	const signIn = useCallback(async (origin: string, token: string) => {
		const session = { origin, token, workspace: null };
		await writeSession(session);
		setState(signedIn(session));
	}, []);

	const forget = useCallback(async () => {
		// The push teardown goes first: if the process dies between the two
		// steps, the session is still there and the next sign-out runs it
		// again. It removes the local items first, so the wait is short even
		// when the network is down. Sign-out never waits for the relay: the
		// teardown goes on in the background after the limit.
		await Promise.race([
			teardownPush(),
			new Promise((resolve) => setTimeout(resolve, TEARDOWN_WAIT_MS)),
		]);
		await wipeSession();
		setState((current) =>
			current.status === "signed_in"
				? {
						status: "signed_out",
						lastOrigin: current.session.origin,
						previous: { session: current.session, client: current.client },
					}
				: current,
		);
	}, []);

	const signOut = useCallback(async () => {
		if (state.status === "signed_in") {
			// The device row goes first, while the token is still valid.
			await unregisterDevice(state.session);
			// A pasted API token can serve a script or the CLI too, so the app
			// does not revoke it. The person revokes it in Preferences.
			if (revokesOnSignOut(state.session.token)) {
				// Signing out must work offline too: a failed revoke still
				// forgets the token here, and the session ends on the server in
				// time.
				await state.client.signOut().catch(() => undefined);
			}
		}
		await forget();
	}, [state, forget]);

	const setWorkspace = useCallback(
		async (slug: string) => {
			if (state.status !== "signed_in") return;
			const session = { ...state.session, workspace: slug };
			await writeSession(session);
			setState({ ...state, session });
		},
		[state],
	);

	const value = useMemo(
		() => ({ state, signIn, signOut, forget, setWorkspace }),
		[state, signIn, signOut, forget, setWorkspace],
	);
	return <SessionContext value={value}>{children}</SessionContext>;
}

export const useSession = (): SessionValue => {
	const value = use(SessionContext);
	if (!value) throw new Error("useSession needs a SessionProvider.");
	return value;
};

export type SignedIn = {
	origin: string;
	client: FarmerClient;
	/** The workspace slug, or null until one is chosen. */
	workspace: string | null;
};

/** The signed-in session. Only the screens behind the sign-in call this. */
export const useSignedIn = (): SignedIn => {
	const { state } = useSession();
	const active =
		state.status === "signed_in"
			? state
			: state.status === "signed_out"
				? state.previous
				: null;
	if (!active) throw new Error("This screen needs a signed-in session.");
	return {
		origin: active.session.origin,
		client: active.client,
		workspace: active.session.workspace,
	};
};
