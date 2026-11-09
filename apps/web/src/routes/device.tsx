import {
	ArrowCounterClockwiseIcon,
	CheckCircleIcon,
	CheckIcon,
	CircleNotchIcon,
	CloudSlashIcon,
	HandIcon,
	HourglassSimpleLowIcon,
	type Icon,
	QuestionIcon,
	SealCheckIcon,
	UserSwitchIcon,
} from "@phosphor-icons/react";
import { usePostHog } from "@posthog/react";
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
import { AuthHead } from "#/components/site/auth-parts.tsx";
import { authClient } from "#/lib/auth-client.ts";
import { getSession } from "#/server/auth.ts";
import { getPublicAppConfig } from "#/server/config.ts";
import { type DeviceClient, getDeviceClient } from "#/server/device.ts";

/**
 * The approval half of `farmer login`: better-auth's device authorization
 * flow, where `verificationUri` is this page. The terminal shows a code, the
 * person signs in here and approves the same code, and the terminal receives
 * a session token.
 *
 * This page hands out a CLI credential, so it guards against a phishing link:
 * an attacker starts `farmer login` on their machine and sends the link to a
 * victim. The defenses are the ten-minute code lifetime (server side), the
 * code in large type, the account it signs in as, and a warning to approve
 * only a code from your own terminal.
 *
 * **Opening the code is a write, so it happens in the browser, after mount.**
 * `GET /api/auth/device` binds a pending code to the signed-in user, with the
 * browser's own cookie (`authClient`). A server render must not run it, or a
 * link preview would bind the code. `DeviceApproval` binds the code once it is
 * on screen. Do not use `ssr: false`: the signed-out redirect would then run
 * during hydration and cause a hydration mismatch against `/login`.
 *
 * **Read the code from the raw query string**, not from the router's parsed
 * search. The router runs `JSON.parse` on each value, so a code such as
 * `2E345678` would arrive as the number Infinity.
 */

/**
 * The words that name the client on this page. The CLI shows a code in a
 * terminal and the mobile app shows it on its sign-in screen, so the page must
 * not say "terminal" to a person who holds a phone.
 */
const CLIENT_TEXT = {
	cli: {
		who: "A terminal",
		place: "your terminal",
		approved: "Terminal approved",
		restart: <code className="fm-code">farmer login</code>,
		verb: "Run",
	},
	mobile: {
		who: "The Farmer app",
		place: "the Farmer app",
		approved: "App approved",
		restart: "the sign-in in the app",
		verb: "Start",
	},
} satisfies Record<
	DeviceClient,
	{
		who: string;
		place: string;
		approved: string;
		restart: ReactNode;
		verb: string;
	}
>;

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
		const userCode = codeFromSearch(location.searchStr);
		// A page with no code yet does not know its client. It words itself for
		// both.
		const client: DeviceClient | null = userCode
			? await getDeviceClient({ data: { userCode } })
			: null;
		return { email: session.user.email, brand: config.org, client };
	},
	component: DevicePage,
});

function DevicePage() {
	const { brand, email, client } = Route.useRouteContext();
	const userCode = useLocation({
		select: (location) => codeFromSearch(location.searchStr),
	});

	return (
		<AuthSplitPanel
			kind="device"
			brand={brand}
			terminalCode={userCode ? formatUserCode(userCode) : null}
			client={client ?? "cli"}
		>
			{userCode ? (
				// Keyed on the code: a code typed into the form below is a new
				// mount, so it is opened (bound) afresh, and the result of approving
				// one code never shows under the next.
				<DeviceApproval
					key={userCode}
					userCode={userCode}
					client={client ?? "cli"}
				/>
			) : (
				<>
					<AuthHead title="Enter the code from your device">
						A terminal prints it when you run{" "}
						<code className="fm-code">farmer login</code>. The Farmer app shows
						it on its sign-in screen.
					</AuthHead>
					<UserCodeForm />
					<p className="fm-auth-fine">
						Signed in as {email}. The device that shows the code will act as
						you.
					</p>
				</>
			)}
		</AuthSplitPanel>
	);
}

/** The code as the device prints it, read out a character at a time. */
function CodeText({ userCode }: { userCode: string }) {
	return (
		<span aria-label={`Code ${userCode.split("").join(" ")}`}>
			{formatUserCode(userCode)}
		</span>
	);
}

function DeviceApproval({
	userCode,
	client,
}: {
	userCode: string;
	client: DeviceClient;
}) {
	const { email } = Route.useRouteContext();
	const text = CLIENT_TEXT[client];
	const posthog = usePostHog();
	const navigate = useNavigate();
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
		posthog.reset();
		window.location.assign(
			`/login?redirect=${encodeURIComponent(devicePath(userCode))}`,
		);
	};

	// Back to the empty form, for a new code. `href` for the reason at the top
	// of this file.
	const enterAnother = () => void navigate({ href: devicePath(null) });
	// Open the same code again: a failure here was the server or the network,
	// not the code.
	const checkAgain = () => {
		setDecision(null);
		openCode(userCode);
	};

	const outcome: Outcome | null =
		decision ??
		opened ??
		(openFailed ? { state: "failed", message: CHECK_FAILED } : null);

	if (!outcome) {
		// What the server renders, and the first client render: nothing to
		// approve until the code is bound, so no buttons yet.
		return (
			<div className="fm-auth-checking" aria-busy="true">
				<CircleNotchIcon size={32} className="fm-auth-spin" aria-hidden />
				<h1 className="fm-auth-title">Checking the code…</h1>
				<p className="fm-auth-code-big">
					<CodeText userCode={userCode} />
				</p>
			</div>
		);
	}

	switch (outcome.state) {
		case "pending":
			return (
				<>
					<AuthHead title="Approve this sign-in?">
						{text.who} wants to read and log time as you. Approve only a code
						that {text.place} shows, after you started the sign-in yourself.
						Farmer never asks you for this code by email or chat.
					</AuthHead>
					<div className="fm-auth-table">
						<div>
							<span className="fm-auth-table-label">Code</span>
							<span className="fm-auth-code-value">
								<CodeText userCode={userCode} />
							</span>
						</div>
						<div>
							<span className="fm-auth-table-label">Account</span>
							{email}
						</div>
					</div>
					<div className="fm-auth-row">
						<button
							type="button"
							className="fm-btn fm-auth-grow"
							disabled={busy !== null}
							onClick={() => act("approve")}
						>
							<CheckIcon size={16} aria-hidden />
							{busy === "approve" ? "Approving…" : "Approve"}
						</button>
						<button
							type="button"
							className="fm-btn fm-btn-outline"
							disabled={busy !== null}
							onClick={() => act("deny")}
						>
							{busy === "deny" ? "Denying…" : "Deny"}
						</button>
					</div>
					<button
						type="button"
						className="fm-auth-link fm-auth-back"
						data-tone="muted"
						onClick={switchAccount}
					>
						Not {email}? Use a different account
					</button>
				</>
			);
		case "approved":
			return (
				<Result icon={CheckCircleIcon} tone="accent" title={text.approved}>
					Go back to {text.place}. It finishes signing in on its own within a
					few seconds, and you can close this tab.
				</Result>
			);
		case "denied":
			return (
				<Result
					icon={HandIcon}
					title="Sign-in denied"
					action={{ label: "Enter another code", onClick: enterAnother }}
				>
					Nothing was signed in. Go back to {text.place}, which stops waiting.
					If you did not start this sign-in, there is nothing else to do.
				</Result>
			);
		case "used":
			return (
				<Result
					icon={SealCheckIcon}
					title="This code was already used"
					action={{ label: "Enter another code", onClick: enterAnother }}
				>
					It has already been approved or denied. Go back to {text.place}. To
					sign in again, {text.verb.toLowerCase()} {text.restart} for a new
					code.
				</Result>
			);
		case "expired":
			return (
				<Result
					icon={HourglassSimpleLowIcon}
					title="This code has expired"
					action={{ label: "Enter another code", onClick: enterAnother }}
				>
					A code lasts ten minutes. {text.verb} {text.restart} in {text.place}{" "}
					again for a new one.
				</Result>
			);
		case "invalid":
			return (
				<Result
					icon={QuestionIcon}
					title="Farmer doesn't know this code"
					action={{ label: "Try again", onClick: enterAnother }}
				>
					Check the code in {text.place} and type it again, or{" "}
					{text.verb.toLowerCase()} {text.restart} for a new one.
				</Result>
			);
		case "not-yours":
			return (
				<Result
					icon={UserSwitchIcon}
					title="This code belongs to another sign-in"
					action={{ label: "Enter another code", onClick: enterAnother }}
				>
					A different account opened this code first, so it cannot be approved
					as {email}. {text.verb} {text.restart} again and open the new link in
					this browser.
				</Result>
			);
		case "failed":
			return (
				<Result
					icon={CloudSlashIcon}
					tone="warn"
					title="Couldn't check this code"
					action={{ label: "Try again", onClick: checkAgain }}
				>
					{outcome.message}
				</Result>
			);
	}
}

function Result({
	icon,
	tone = "muted",
	title,
	action,
	children,
}: {
	icon: Icon;
	tone?: "accent" | "warn" | "muted";
	title: string;
	action?: { label: string; onClick: () => void };
	children: ReactNode;
}) {
	return (
		<>
			<AuthHead icon={icon} tone={tone} size="lg" title={title}>
				{children}
			</AuthHead>
			{action ? (
				<button
					type="button"
					className="fm-btn fm-btn-outline fm-auth-start"
					onClick={action.onClick}
				>
					<ArrowCounterClockwiseIcon size={16} aria-hidden />
					{action.label}
				</button>
			) : null}
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
		<form className="fm-auth-form" onSubmit={submit}>
			<input
				className="fm-auth-code-input"
				aria-label="Code from your device"
				value={value}
				onChange={(event) => setValue(event.target.value.toUpperCase())}
				placeholder="XXXX-XXXX"
				autoComplete="one-time-code"
				autoCapitalize="characters"
				spellCheck={false}
			/>
			<button type="submit" className="fm-btn fm-btn-block" disabled={!code}>
				Continue
			</button>
		</form>
	);
}
