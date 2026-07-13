import type { UpdateNotificationSettingsInput } from "@farmer/core/schema";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Switch } from "#/components/ui/switch.tsx";
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
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: (value: boolean) =>
			updateNotificationSettings({ data: patch(value) }),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: notificationSettingsQuery().queryKey,
			});
		},
		onError: (error) => {
			toast.error(error.message ?? "Could not update setting");
		},
	});
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5">
			<div className="min-w-0">
				<span className="text-sm font-medium">{title}</span>
				<p className="text-xs text-muted-foreground">{description}</p>
			</div>
			<Switch
				checked={checked}
				onCheckedChange={(value) => mutation.mutate(value)}
				disabled={disabled || mutation.isPending}
			/>
		</div>
	);
}

export function NotificationSettings() {
	const { data: settings } = useSuspenseQuery(notificationSettingsQuery());
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
				error instanceof Error ? error.message : "Could not enable notifications",
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
		<div className="-mx-4 mt-6 border-t px-4 pt-6 sm:-mx-8 sm:px-8">
			<div className="flex items-center gap-2">
				<Bell className="size-4 text-muted-foreground" />
				<span className="text-sm font-semibold">Notifications</span>
				{subscribed && <Badge variant="secondary">On this device</Badge>}
			</div>
			<p className="mt-1 text-xs text-muted-foreground">
				Get OS-level notifications — they reach you even when Farmer isn't open.
				You enable them per device.
			</p>

			<div className="mt-4 flex flex-col items-start gap-3 rounded-lg border bg-muted/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<span className="text-sm font-medium">This device</span>
					<p className="text-xs text-muted-foreground">
						{!supported
							? "This browser doesn't support push notifications."
							: permission === "denied"
								? "Blocked. Allow notifications for this site in your browser settings, then try again."
								: subscribed
									? "This device will receive notifications."
									: "Turn on to receive notifications on this device."}
					</p>
				</div>
				{supported &&
					(subscribed ? (
						<Button variant="outline" onClick={disable} disabled={busy}>
							{busy ? "Working…" : "Turn off"}
						</Button>
					) : (
						<Button onClick={enable} disabled={busy || permission === "denied"}>
							{busy ? "Working…" : "Enable"}
						</Button>
					))}
			</div>

			<div className="mt-3 flex flex-col gap-2.5">
				<NotifyToggleRow
					title="Time-off decisions"
					description="Get notified when your time-off request is approved or denied."
					checked={settings.timeOffDecisions}
					patch={(value) => ({ timeOffDecisions: value })}
					disabled={togglesDisabled}
				/>
				<NotifyToggleRow
					title="Log reminders"
					description="A nudge at the end of the day if you're under your expected hours."
					checked={settings.logReminders}
					patch={(value) => ({ logReminders: value })}
					disabled={togglesDisabled}
				/>
			</div>
		</div>
	);
}
