import { useMutation } from "@tanstack/react-query";
import {
	createFileRoute,
	notFound,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { z } from "zod";

import { AuthSplitPanel } from "#/components/auth-split-panel.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { getSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";

/**
 * The approval half of `farmer login` — better-auth's device authorization
 * flow, where `verificationUri` is this page.
 *
 * The terminal shows a code and opens `/device?user_code=…`; the person signs
 * in here, sees the same code, and approves it; the terminal, polling all the
 * while, receives a session token. So this page is the one place a CLI
 * credential is handed out, and it is built around the attack that flow
 * invites: somebody starts `farmer login` on THEIR machine and sends the link
 * to a victim. What stands against that is the ten-minute code lifetime
 * (server-side), and here the code in large type, the account it would sign in
 * as, and the warning to approve only a code your own terminal shows.
 *
 * **Opening the code is a write, so it happens in the browser, after mount.**
 * `GET /api/auth/device` binds a pending code to the signed-in user, and
 * approve refuses a code nobody has bound. That call has to carry the
 * browser's own cookie to better-auth, which is what `authClient` does, and it
 * must not run during a server render — a loader would, for every document
 * request, including a link preview fetching the URL. So the route renders on
 * the server as usual (the session check and the signed-out redirect happen
 * there, before any JavaScript), and `DeviceApproval` binds the code once it
 * is on screen.
 *
 * Not `ssr: false`, which was tried: a client-only route that redirects a
 * signed-out visitor does so during hydration, and React then hydrates
 * `/login`'s markup against this route's pending shell — a hydration mismatch
 * on the very page the person has to type into next.
 *
 * **The code is read from the raw query string**, not from the router's parsed
 * search. TanStack Router runs each search value through `JSON.parse`, and a
 * user code is drawn from letters and digits, so a code such as `2E345678`
 * would arrive as the number 2e345678 — Infinity — and be sent to the server as
 * the wrong code.
 */

/** Only letters and digits reach the server, upper-cased: the CLI shows the
 *  code in groups, people type it with dashes or spaces or in lower case, and
 *  the router may have wrapped it in JSON quotes. */
const normalizeUserCode = (raw: string | null): string | null => {
	const code = (raw ?? "")
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 32);
	return code || null;
};

const codeFromSearch = (searchStr: string) =>
	normalizeUserCode(new URLSearchParams(searchStr).get("user_code"));

const devicePath = (userCode: string | null) =>
	userCode ? `/device?user_code=${encodeURIComponent(userCode)}` : "/device";

/** "ABCD-EFGH". The dash is display only; `normalizeUserCode` removes it. */
const formatUserCode = (code: string) =>
	(code.match(/.{1,4}/g) ?? [code]).join("-");

type Outcome =
	| { state: "pending" }
	| { state: "approved" }
	| { state: "denied" }
	| { state: "used" }
	| { state: "expired" }
	| { state: "invalid" }
	| { state: "not-yours" }
	| { state: "failed"; message: string };

const CHECK_FAILED =
	"Farmer could not check this code. Check your connection and try again.";

/** The fields better-auth's device endpoints put in an error body. */
const deviceErrorBody = z.object({
	error: z.string().optional(),
	error_description: z.string().optional(),
	message: z.string().optional(),
});

/**
 * Turn a refused device call into something a person can act on.
 *
 * better-auth distinguishes the cases by `error`, and for two of them only by
 * the sentence in `error_description`: "already processed" and "invalid user
 * code" are both `invalid_request`. Those sentences are its error-code table
 * (`DEVICE_AUTHORIZATION_ERROR_CODES`), so a changed wording degrades to the
 * generic message below rather than to a wrong one.
 */
const outcomeOf = (error: { status: number; message?: string }): Outcome => {
	const parsed = deviceErrorBody.safeParse(error);
	const body = parsed.success ? parsed.data : {};
	const description = body.error_description ?? body.message;
	if (body.error === "expired_token") return { state: "expired" };
	// Another account opened this code first, so it is bound to them.
	if (body.error === "access_denied" || error.status === 403) {
		return { state: "not-yours" };
	}
	if (description === "Device code already processed") return { state: "used" };
	// A 404 is `CLI_ENABLED=false` on the device endpoints: there is no code to
	// approve on this server, which reads the same as an unknown code.
	if (description === "Invalid user code" || error.status === 404) {
		return { state: "invalid" };
	}
	return { state: "failed", message: description ?? CHECK_FAILED };
};

export const Route = createFileRoute("/device")({
	beforeLoad: async ({ location }) => {
		const [config, session] = await Promise.all([
			getPublicAppConfig(),
			getSession(),
		]);
		if (!config.cliEnabled) throw notFound();
		if (!session) {
			// Through `/login`, which carries `redirect` through the Google round
			// trip (and the development password form) and accepts it only as a
			// same-site path. The query string is part of that path, so the code
			// arrives back here intact.
			throw redirect({
				to: "/login",
				search: { redirect: devicePath(codeFromSearch(location.searchStr)) },
			});
		}
		return { email: session.user.email, brand: config.org };
	},
	component: DevicePage,
});

function DevicePage() {
	const { brand } = Route.useRouteContext();
	const userCode = useLocation({
		select: (location) => codeFromSearch(location.searchStr),
	});

	return (
		<AuthSplitPanel tagline="Your timesheet, from the terminal." brand={brand}>
			<div className="eyebrow-lg">Farmer CLI</div>
			{userCode ? (
				// Keyed on the code: a code typed into the form below is a new
				// mount, so it is opened (bound) afresh, and the result of approving
				// one code never shows under the next.
				<DeviceApproval key={userCode} userCode={userCode} />
			) : (
				<>
					<h1 className="h2 mt-3">Connect a terminal</h1>
					<p className="lede mt-2">
						Enter the code that <code>farmer login</code> shows in your
						terminal.
					</p>
					<UserCodeForm />
				</>
			)}
		</AuthSplitPanel>
	);
}

function BigCode({ userCode }: { userCode: string }) {
	return (
		<p
			className="mt-6 text-center font-mono text-4xl font-medium tracking-[0.18em] sm:text-5xl"
			aria-label={`Code ${userCode.split("").join(" ")}`}
		>
			{formatUserCode(userCode)}
		</p>
	);
}

function DeviceApproval({ userCode }: { userCode: string }) {
	const { email } = Route.useRouteContext();
	const [decision, setDecision] = useState<Outcome | null>(null);
	const [busy, setBusy] = useState<"approve" | "deny" | null>(null);

	// Opening the code binds it to this account — see the note at the top of
	// the file for why this is a mutation run on mount rather than a loader.
	// Running it twice (React's development double effect) is harmless: the
	// server binds only a pending, unbound code, and reports the same status.
	const {
		mutate: openCode,
		data: opened,
		isError: openFailed,
	} = useMutation({
		mutationFn: async (code: string): Promise<Outcome> => {
			const { data, error } = await authClient.device({
				query: { user_code: code },
			});
			if (error) return outcomeOf(error);
			return data.status === "pending"
				? { state: "pending" }
				: { state: "used" };
		},
	});
	useEffect(() => {
		openCode(userCode);
	}, [openCode, userCode]);

	const act = async (action: "approve" | "deny") => {
		setBusy(action);
		const { error } =
			action === "approve"
				? await authClient.device.approve({ userCode })
				: await authClient.device.deny({ userCode });
		setBusy(null);
		if (error) {
			setDecision(outcomeOf(error));
			return;
		}
		setDecision({ state: action === "approve" ? "approved" : "denied" });
	};

	// Signing out and straight back in, to this same code. A code that this
	// account already opened stays bound to it, so the other account is refused —
	// which is why "not yours" below says to start again instead.
	const switchAccount = async () => {
		await authClient.signOut();
		window.location.assign(
			`/login?redirect=${encodeURIComponent(devicePath(userCode))}`,
		);
	};

	const outcome: Outcome | null =
		decision ??
		opened ??
		(openFailed ? { state: "failed", message: CHECK_FAILED } : null);

	if (!outcome) {
		// What the server renders, and the first client render: nothing to
		// approve until the code is bound, so no buttons yet.
		return (
			<>
				<h1 className="h2 mt-3">Checking the code…</h1>
				<p className="lede mt-2">
					Signed in as <strong className="text-foreground">{email}</strong>.
				</p>
				<BigCode userCode={userCode} />
			</>
		);
	}

	switch (outcome.state) {
		case "pending":
			return (
				<>
					<h1 className="h2 mt-3">Approve this sign-in?</h1>
					<p className="lede mt-2">
						A terminal is asking to sign in to Farmer as{" "}
						<strong className="text-foreground">{email}</strong>. Check that it
						shows this code:
					</p>
					<BigCode userCode={userCode} />
					<p
						role="note"
						className="mt-6 rounded-lg border bg-muted px-4 py-3 text-sm leading-normal"
					>
						Approve only a code that your own terminal shows. Farmer never asks
						you for this code by email or chat.
					</p>
					<div className="mt-6 grid grid-cols-2 gap-3">
						<Button
							variant="outline"
							disabled={busy !== null}
							onClick={() => act("deny")}
						>
							{busy === "deny" ? "Denying…" : "Deny"}
						</Button>
						<Button disabled={busy !== null} onClick={() => act("approve")}>
							{busy === "approve" ? "Approving…" : "Approve"}
						</Button>
					</div>
					<button
						type="button"
						className="mt-4 self-start text-sm text-muted-foreground underline-offset-4 hover:underline"
						onClick={switchAccount}
					>
						Not {email}? Use a different account
					</button>
				</>
			);
		case "approved":
			return (
				<Result title="Terminal approved">
					Go back to your terminal. It finishes signing in on its own within a
					few seconds, and you can close this tab.
				</Result>
			);
		case "denied":
			return (
				<Result title="Sign-in denied">
					Nothing was signed in. Go back to your terminal, which stops waiting.
					If you did not start this sign-in, there is nothing else to do.
				</Result>
			);
		case "used":
			return (
				<Result title="This code was already used" retry>
					It has already been approved or denied. Go back to your terminal. To
					sign in again, run <code>farmer login</code> for a new code.
				</Result>
			);
		case "expired":
			return (
				<Result title="This code has expired" retry>
					A code lasts ten minutes. Run <code>farmer login</code> in your
					terminal again for a new one.
				</Result>
			);
		case "invalid":
			return (
				<Result title="Farmer doesn't know this code" retry>
					Check the code in your terminal and type it again, or run{" "}
					<code>farmer login</code> for a new one.
				</Result>
			);
		case "not-yours":
			return (
				<Result title="This code belongs to another sign-in" retry>
					A different account opened this code first, so it cannot be approved
					as {email}. Run <code>farmer login</code> again and open the new link
					in this browser.
				</Result>
			);
		case "failed":
			return (
				<Result title="Couldn't check this code" retry>
					{outcome.message}
				</Result>
			);
	}
}

function Result({
	title,
	retry = false,
	children,
}: {
	title: string;
	retry?: boolean;
	children: ReactNode;
}) {
	return (
		<>
			<h1 className="h2 mt-3">{title}</h1>
			<p className="lede mt-2">{children}</p>
			{retry ? <UserCodeForm /> : null}
		</>
	);
}

function UserCodeForm() {
	const navigate = useNavigate();
	const [value, setValue] = useState("");
	const code = normalizeUserCode(value);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (!code) return;
		// `href` rather than `search`, for the reason at the top of this file:
		// the router would JSON-encode a code that looks like a number.
		await navigate({ href: devicePath(code) });
	};

	return (
		<form className="mt-6 flex flex-col gap-3" onSubmit={submit}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="device-user-code">Code from your terminal</Label>
				<Input
					id="device-user-code"
					value={value}
					onChange={(event) => setValue(event.target.value.toUpperCase())}
					placeholder="ABCD-EFGH"
					autoComplete="one-time-code"
					autoCapitalize="characters"
					spellCheck={false}
					className="font-mono tracking-widest"
				/>
			</div>
			<Button type="submit" disabled={!code}>
				Continue
			</Button>
		</form>
	);
}
