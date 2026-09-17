import type { UpdateNotificationSettingsInput } from "@farmer/core/schema";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	PageSection,
	SettingList,
	SettingRow,
} from "#/components/ui/page-header.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { useOrgSlug } from "#/hooks/use-org-slug.ts";
import {
	currentPermission,
	disablePush,
	enablePush,
	isSubscribed,
	pushSupported,
} from "#/lib/push.ts";
import { notificationSettingsQuery } from "#/queries/notifications.ts";
import { updateNotificationSettings } from "#/server/notifications.ts";

// One notification-preference toggle, backed by notificationSettings. Same
// shape as the integrations SettingToggleRow.
function NotifyToggleRow({
	title,
	description,
	checked,
	patch,
	disabled,
}: {
	title: string;
	description: string;
	checked: boolean;
	patch: (value: boolean) => UpdateNotificationSettingsInput;
	disabled?: boolean;
}) {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	const mutation = useMutation({
		mutationFn: (value: boolean) =>
			updateNotificationSettings({ data: patch(value) }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: notificationSettingsQuery(orgSlug).queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update setting");
		},
	});

	return (
		<SettingRow
			title={title}
			description={description}
			action={
				<Switch
					checked={checked}
					onCheckedChange={(value) => mutation.mutate(value)}
					disabled={disabled || mutation.isPending}
				/>
			}
		/>
	);
}

export function NotificationSettings() {
	const orgSlug = useOrgSlug();

	const { data: settings } = useSuspenseQuery(
		notificationSettingsQuery(orgSlug),
	);

	const [supported, setSupported] = useState(true);
	const [subscribed, setSubscribed] = useState(false);

	const [permission, setPermission] = useState<
		NotificationPermission | "unsupported"
	>("default");

	const [busy, setBusy] = useState(false);

	// Device-level push state is client-only (OS permission + a live
	// PushManager subscription), so resolve it after mount.
	useEffect(() => {
		if (!pushSupported()) {
			setSupported(false);
			setPermission("unsupported");

			return;
		}

		setPermission(currentPermission());
		isSubscribed().then(setSubscribed);
	}, []);

	const enable = async () => {
		setBusy(true);

		try {
			const result = await enablePush();

			if (result === "subscribed") {
				setSubscribed(true);
				setPermission("granted");
				toast.success("Notifications enabled on this device");
			} else if (result === "denied") {
				setPermission("denied");
				toast.error(
					"Notifications are blocked. Allow them for this site in your browser settings.",
				);
			} else if (result === "unconfigured") {
				toast.error("Push notifications aren't configured on the server.");
			} else {
				setSupported(false);
				toast.error("This browser doesn't support notifications.");
			}
		} catch (error) {
			toast.error(
				error instanceof Error
					? error.message
					: "Could not enable notifications",
			);
		} finally {
			setBusy(false);
		}
	};

	const disable = async () => {
		setBusy(true);

		try {
			await disablePush();
			setSubscribed(false);
			toast.success("Notifications disabled on this device");
		} finally {
			setBusy(false);
		}
	};

	// The per-type toggles only matter once this device can actually receive a
	// push, so they're disabled until subscribed.
	const togglesDisabled = !subscribed;

	return (
		<PageSection
			title={
				<span className="flex items-center gap-2">
					Notifications
					{subscribed && <Badge variant="secondary">On this device</Badge>}
				</span>
			}
			description="Get OS-level notifications — they reach you even when Farmer isn't open. You enable them per device."
		>
			{/* Rows, not tinted panels. Everything on this page is a setting with a
			    label, a note and a control; giving each one a filled rectangle turned
			    a list into a stack of cards for no gain in legibility. */}
			<SettingList>
				<SettingRow
					title="This device"
					description={
						!supported
							? "This browser doesn't support push notifications."
							: permission === "denied"
								? "Blocked. Allow notifications for this site in your browser settings, then try again."
								: subscribed
									? "This device will receive notifications."
									: "Turn on to receive notifications on this device."
					}
					action={
						supported &&
						(subscribed ? (
							<Button
								variant="outline"
								size="sm"
								onClick={disable}
								disabled={busy}
							>
								{busy ? "Working…" : "Turn off"}
							</Button>
						) : (
							<Button
								size="sm"
								onClick={enable}
								disabled={busy || permission === "denied"}
							>
								{busy ? "Working…" : "Enable"}
							</Button>
						))
					}
				/>
				<NotifyToggleRow
					title="Log reminders"
					description="A nudge when you have unlogged days, mirroring the Slack reminder."
					checked={settings.logReminders}
					patch={(value) => ({ logReminders: value })}
					disabled={togglesDisabled}
				/>
			</SettingList>
		</PageSection>
	);
}
