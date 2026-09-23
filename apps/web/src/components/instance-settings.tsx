import type {
	ConnectionTestResult,
	InstanceSettingView,
} from "@farmer/core/services";
import {
	useMutation,
	useQueryClient,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { redirect, useRouteContext } from "@tanstack/react-router";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";

import { StatusPill } from "#/components/status-pill.tsx";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { PageSection } from "#/components/ui/page-header.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { instanceSettingsQuery } from "#/queries/instance-settings.ts";
import { platformKeys } from "#/queries/keys.ts";
import { updateInstanceSettings } from "#/server/instance-settings.ts";

/**
 * The Infrastructure pages' shared half: the gate, the settings form one
 * section at a time, and the "test it" row two of the pages carry.
 *
 * **One form per group, one field per `INSTANCE_SETTINGS` entry.** The registry
 * in `@farmer/core/lib/instance-settings` is the only list of what is
 * configurable, so the pages draw whatever it holds for their section and add
 * nothing by hand. A new setting shows up here without a line of UI.
 *
 * **The environment wins, and the field says so** (ADR 0004). A locked field
 * is drawn disabled with "Set by the environment" beside it, and is never in a
 * save: the service would refuse the whole write over it.
 *
 * **A secret is never sent back**, so its box is never prefilled. The view's
 * `secretHint` goes in the placeholder, an empty box means "keep it", and
 * clearing one is its own explicit Remove — an empty box meaning "delete" would
 * wipe a key the first time somebody saved an unrelated field.
 */

/** Every Infrastructure page's `beforeLoad`, the same test as Platform
 *  admins: read off the parent layout's context, since the real refusal is
 *  `platformAdminMiddleware` on every server function behind the page. */
export const requirePlatformAdmin = ({
	context,
	params,
}: {
	context: { isPlatformAdmin: boolean };
	params: { orgSlug: string };
}) => {
	if (!context.isPlatformAdmin) {
		throw redirect({
			to: "/$orgSlug/settings",
			params: { orgSlug: params.orgSlug },
		});
	}
};

type Section = InstanceSettingView["section"];
type Changes = Record<string, string | null>;

/** What the storage page asks before a save that moves the store. */
export type SaveConfirmation = {
	title: string;
	description: ReactNode;
	action: string;
};

const isSecret = (setting: InstanceSettingView) =>
	setting.kind === "secret" || setting.kind === "multiline";

/** Base UI's Select has no "no value" item, and an empty string reads as no
 *  selection at all, so the "not set" choice travels under this name. */
const UNSET = "__unset__";

/** The spelling of a select's option on screen. The stored value stays the
 *  lower-case one the environment variable takes. */
const OPTION_LABEL = new Map([
	["resend", "Resend"],
	["smtp", "SMTP"],
]);

/** The box's starting text. A default is a placeholder, not a value: typed
 *  into the box, it would be saved as a row the first time anything else was,
 *  and would stop following the default when the default changes. */
const initialValue = (setting: InstanceSettingView): string => {
	if (isSecret(setting)) return "";
	if (setting.kind === "boolean") {
		return setting.value === "true" ? "true" : "false";
	}
	return setting.source === "db" ? (setting.value ?? "") : "";
};

const initialDraft = (settings: InstanceSettingView[]) =>
	Object.fromEntries(settings.map((s) => [s.name, initialValue(s)]));

/** Only what the person changed, in the shape `updateInstanceSettings`
 *  takes: a string sets, `null` clears, and an untouched name is absent. */
const changesOf = (
	settings: InstanceSettingView[],
	draft: Record<string, string>,
	removed: ReadonlySet<string>,
): Changes => {
	const changes = new Map<string, string | null>();
	for (const setting of settings) {
		if (setting.locked) continue;
		const value = draft[setting.name] ?? "";
		if (isSecret(setting)) {
			if (removed.has(setting.name)) changes.set(setting.name, null);
			else if (value.trim() !== "") changes.set(setting.name, value);
			continue;
		}
		if (setting.kind === "boolean") {
			if (value !== initialValue(setting)) changes.set(setting.name, value);
			continue;
		}
		const trimmed = value.trim();
		if (trimmed !== initialValue(setting)) {
			changes.set(setting.name, trimmed === "" ? null : trimmed);
		}
	}
	return Object.fromEntries(changes);
};

/**
 * A hint, with `{origin}` filled in and `code` spans drawn as code.
 *
 * The registry writes a callback URL as `{origin}/api/…` because it cannot
 * know the deployment's address; the page can, and a URL somebody pastes into
 * Google's console has to be the whole one. The origin is `appOrigin`, the
 * same `BETTER_AUTH_URL`-derived answer the MCP and CLI rows use, rather than
 * the tab's address, which may be a preview host the provider never calls.
 */
export function SettingHint({ text }: { text: string }) {
	const appOrigin = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.appOrigin,
	});
	const parts = text.replaceAll("{origin}", appOrigin).split("`");
	return (
		<p className="text-xs leading-normal break-words text-muted-foreground">
			{parts.map((part, index) =>
				index % 2 === 1 ? (
					// oxlint-disable-next-line react/no-array-index-key -- the parts are a fixed split of one static string, so the index is the identity
					<code key={index} className="font-mono">
						{part}
					</code>
				) : (
					part
				),
			)}
		</p>
	);
}

/** The label line: the caption, and the badge that explains a disabled box. */
function FieldLabel({
	htmlFor,
	setting,
}: {
	htmlFor: string;
	setting: InstanceSettingView;
}) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Label htmlFor={htmlFor}>{setting.label}</Label>
			{setting.locked && (
				<Badge variant="secondary">Set by the environment</Badge>
			)}
		</div>
	);
}

function SettingField({
	setting,
	value,
	removed,
	onChange,
	onRemove,
	disabled,
}: {
	setting: InstanceSettingView;
	value: string;
	removed: boolean;
	onChange: (value: string) => void;
	onRemove: (removed: boolean) => void;
	disabled: boolean;
}) {
	const id = useId();
	const locked = setting.locked;
	const hint = setting.hint && <SettingHint text={setting.hint} />;

	if (setting.kind === "boolean") {
		// The environment's value is still the state on show when it is locked:
		// "on, and you cannot change it here" is the answer somebody came for.
		const checked = locked ? setting.value === "true" : value === "true";
		return (
			<div className="flex max-w-xl items-start justify-between gap-6">
				<div className="grid gap-1.5">
					<FieldLabel htmlFor={id} setting={setting} />
					{hint}
				</div>
				<Switch
					id={id}
					checked={checked}
					disabled={locked || disabled}
					onCheckedChange={(on) => onChange(on ? "true" : "false")}
				/>
			</div>
		);
	}

	if (setting.kind === "select") {
		const options = setting.options ?? [];
		// An empty option in the registry means the server picks, which is a
		// choice with a name; without one, empty is simply nothing stored.
		const unsetLabel = options.includes("") ? "Automatic" : "Not set";
		const items = [
			{ value: UNSET, label: unsetLabel },
			...options
				.filter((option) => option !== "")
				.map((option) => ({
					value: option,
					label: OPTION_LABEL.get(option) ?? option,
				})),
		];
		const current = locked ? (setting.value ?? "") : value;
		return (
			<div className="grid max-w-xl gap-1.5">
				<FieldLabel htmlFor={id} setting={setting} />
				<Select
					items={items}
					value={current === "" ? UNSET : current}
					disabled={locked || disabled}
					onValueChange={(next: string | null) =>
						onChange(next === null || next === UNSET ? "" : next)
					}
				>
					<SelectTrigger id={id} className="w-full max-w-sm bg-card">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{items.map((item) => (
							<SelectItem key={item.value} value={item.value}>
								{item.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{hint}
			</div>
		);
	}

	if (isSecret(setting)) {
		// A locked secret cannot be replaced here, so its box shows only the
		// hint of the environment's value.
		const placeholder = removed
			? "Removed when you save"
			: setting.secretHint
				? locked
					? setting.secretHint
					: `${setting.secretHint} — type to replace`
				: "Not set";
		// Remove is offered only for a stored secret: one from the environment
		// is locked, and one that is not set has nothing to remove.
		const removable = !locked && setting.source === "db" && setting.secretHint;
		const remove = removable && (
			<Button
				type="button"
				variant="outline"
				className={removed ? undefined : "hover:text-destructive"}
				disabled={disabled}
				onClick={() => onRemove(!removed)}
			>
				{removed ? "Undo" : "Remove"}
			</Button>
		);
		const box =
			setting.kind === "multiline" ? (
				<Textarea
					id={id}
					rows={5}
					spellCheck={false}
					autoComplete="off"
					className="font-mono text-xs"
					value={removed ? "" : value}
					placeholder={placeholder}
					disabled={locked || removed || disabled}
					onChange={(event) => onChange(event.target.value)}
				/>
			) : (
				<Input
					id={id}
					type="password"
					// A browser that offers to save or fill this box would put a
					// person's own password into an API key field.
					autoComplete="new-password"
					value={removed ? "" : value}
					placeholder={placeholder}
					disabled={locked || removed || disabled}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
		return (
			<div className="grid max-w-xl gap-1.5">
				<FieldLabel htmlFor={id} setting={setting} />
				{setting.kind === "multiline" ? (
					<>
						{box}
						{remove && <div>{remove}</div>}
					</>
				) : (
					<div className="flex items-center gap-2">
						{box}
						{remove}
					</div>
				)}
				{hint}
			</div>
		);
	}

	return (
		<div className="grid max-w-xl gap-1.5">
			<FieldLabel htmlFor={id} setting={setting} />
			<Input
				id={id}
				value={locked ? (setting.value ?? "") : value}
				// The default, where there is one, is what the server uses with an
				// empty box, so the box shows it rather than a generic prompt.
				placeholder={
					setting.source === "default" ? (setting.value ?? "") : undefined
				}
				disabled={locked || disabled}
				onChange={(event) => onChange(event.target.value)}
			/>
			{hint}
		</div>
	);
}

/**
 * One Infrastructure page's settings, grouped under the registry's own
 * sub-headings, each group with its own Save.
 *
 * A group is one app or one concern (Google, SMTP, the S3 store), and its
 * values only make sense together, so a group saves as one. Two groups never
 * share a save: a change to the single-org slug must not wait under, or be
 * sent with, the GitHub app below it. The Save row shows only while its group
 * has a change.
 */
export function InstanceSettingsForm({
	section,
	groupNotes,
	confirmBeforeSave,
}: {
	section: Section;
	/** A line under a group's heading, keyed by the group's name. */
	groupNotes?: Record<string, ReactNode>;
	/** Asked before a save; an answer is shown as a confirm dialog, and the
	 *  save that follows it is sent with `confirmStorageMove`. Only the
	 *  storage page passes one. */
	confirmBeforeSave?: (changes: Changes) => Promise<SaveConfirmation | null>;
}) {
	const { data } = useSuspenseQuery(instanceSettingsQuery());
	// The registry's order, which is also the order its groups first appear in.
	const groups: { name: string; settings: InstanceSettingView[] }[] = [];
	for (const setting of data) {
		if (setting.section !== section) continue;
		const group = groups.find((g) => g.name === setting.group);
		if (group) group.settings.push(setting);
		else groups.push({ name: setting.group, settings: [setting] });
	}
	return groups.map((group) => (
		<GroupForm
			// Remounted when the group's saved values change, so a save, or a
			// change another admin made, resets its boxes to what is stored. The
			// key is per group, so a save in one group keeps a draft in another.
			key={`${group.name}:${JSON.stringify(group.settings)}`}
			title={group.name}
			description={groupNotes?.[group.name]}
			settings={group.settings}
			confirmBeforeSave={confirmBeforeSave}
		/>
	));
}

function GroupForm({
	title,
	description,
	settings,
	confirmBeforeSave,
}: {
	title: string;
	description?: ReactNode;
	settings: InstanceSettingView[];
	confirmBeforeSave?: (changes: Changes) => Promise<SaveConfirmation | null>;
}) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState(() => initialDraft(settings));
	const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
	const [checking, setChecking] = useState(false);
	const [confirming, setConfirming] = useState<{
		changes: Changes;
		prompt: SaveConfirmation;
	} | null>(null);

	const changes = changesOf(settings, draft, removed);
	const changed = Object.keys(changes).length > 0;

	const reset = () => {
		setDraft(initialDraft(settings));
		setRemoved(new Set());
	};

	const save = useMutation({
		mutationFn: (input: { changes: Changes; confirmStorageMove?: boolean }) =>
			updateInstanceSettings({ data: input }),
		onSuccess: async () => {
			// Reset first: a secret re-entered with the same first characters
			// leaves the view unchanged, so the remount would not clear its box.
			reset();
			setConfirming(null);
			await queryClient.invalidateQueries({ queryKey: platformKeys.settings });
			toast.success(`${title} saved`);
		},
		// The service refuses with the reason ("S3_BUCKET is set by the
		// environment"), so show it rather than a generic failure.
		onError: (error: Error) => toast.error(error.message),
	});

	const busy = save.isPending || checking;

	const submit = async () => {
		if (!changed) return;
		if (confirmBeforeSave) {
			setChecking(true);
			try {
				const prompt = await confirmBeforeSave(changes);
				if (prompt) {
					setConfirming({ changes, prompt });
					return;
				}
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Could not check the store",
				);
				return;
			} finally {
				setChecking(false);
			}
		}
		save.mutate({ changes });
	};

	return (
		<PageSection title={title} description={description}>
			<div className="grid gap-5">
				{settings.map((setting) => (
					<SettingField
						key={setting.name}
						setting={setting}
						value={draft[setting.name] ?? ""}
						removed={removed.has(setting.name)}
						disabled={busy}
						onChange={(value) =>
							setDraft((current) => ({
								...current,
								[setting.name]: value,
							}))
						}
						onRemove={(remove) =>
							setRemoved((current) => {
								const next = new Set(current);
								if (remove) next.add(setting.name);
								else next.delete(setting.name);
								return next;
							})
						}
					/>
				))}
			</div>

			{(changed || busy) && (
				<div className="mt-5 flex items-center gap-3">
					<Button disabled={busy} onClick={() => void submit()}>
						{busy ? "Saving…" : "Save"}
					</Button>
					<Button variant="ghost" disabled={busy} onClick={reset}>
						Discard
					</Button>
				</div>
			)}

			<AlertDialog
				open={confirming !== null}
				onOpenChange={(open) => {
					if (!open) setConfirming(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{confirming?.prompt.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{confirming?.prompt.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={save.isPending}
							onClick={() => {
								if (confirming) {
									save.mutate({
										changes: confirming.changes,
										confirmStorageMove: true,
									});
								}
							}}
						>
							{confirming?.prompt.action}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageSection>
	);
}

/**
 * A button that tries the saved configuration, and the answer beside it.
 *
 * It tests what is SAVED, not what is in the boxes above: the server sends
 * the mail or talks to the store with the values it would use for real, and a
 * test of an unsaved draft would pass and then prove nothing about the next
 * upload. The description says so, since that is the first thing to go wrong.
 */
export function ConnectionCheck({
	title,
	description,
	label,
	run,
}: {
	title: string;
	description: ReactNode;
	label: string;
	run: () => Promise<ConnectionTestResult>;
}) {
	const check = useMutation({
		mutationFn: run,
		onError: (error: Error) => toast.error(error.message),
	});

	return (
		<PageSection title={title} description={description}>
			<div className="flex flex-wrap items-center gap-3">
				<Button
					variant="outline"
					disabled={check.isPending}
					onClick={() => check.mutate()}
				>
					{check.isPending ? "Working…" : label}
				</Button>
				{check.data && !check.isPending && (
					<span className="flex min-w-0 items-center gap-2 text-sm">
						<StatusPill tone={check.data.ok ? "positive" : "negative"}>
							{check.data.ok ? "Works" : "Failed"}
						</StatusPill>
						<span className="min-w-0 break-words text-muted-foreground">
							{check.data.message}
						</span>
					</span>
				)}
			</div>
		</PageSection>
	);
}
