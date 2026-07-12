import { toast } from "sonner";
import { Button } from "#/components/ui/button.tsx";
import { authClient } from "#/lib/auth-client.ts";

/**
 * Append truthy invite-context values (org/orgSlug/role/email) to a path as
 * query params — used to build the Google `callbackURL` so an invited user
 * lands where the email flow would take them. Tolerates a path that already
 * carries a query string.
 */
export function buildCallbackURL(
	path: string,
	context: Record<string, string | undefined>,
) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(context)) {
		if (value) params.set(key, value);
	}
	const query = params.toString();
	if (!query) return path;
	return `${path}${path.includes("?") ? "&" : "?"}${query}`;
}

export function GoogleIcon() {
	return (
		<svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
			<title>Google</title>
			<path
				fill="#4285F4"
				d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
			/>
			<path
				fill="#34A853"
				d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
			/>
			<path
				fill="#FBBC05"
				d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
			/>
			<path
				fill="#EA4335"
				d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
			/>
		</svg>
	);
}

/**
 * "Sign in with Google" — uses the identity-only `google` social provider
 * (email/profile). The Calendar integration is a separate `google-calendar`
 * grant linked from Settings, so logging in never asks for calendar access.
 * On success better-auth performs a full-page redirect to `callbackURL`.
 */
export function GoogleSignInButton({
	label,
	callbackURL,
}: {
	label: string;
	callbackURL: string;
}) {
	const onClick = async () => {
		const { error } = await authClient.signIn.social({
			provider: "google",
			callbackURL,
		});
		if (error) {
			toast.error(error.message ?? "Could not sign in with Google");
		}
	};

	return (
		<Button
			type="button"
			variant="outline"
			className="w-full gap-2"
			onClick={onClick}
		>
			<GoogleIcon />
			{label}
		</Button>
	);
}
