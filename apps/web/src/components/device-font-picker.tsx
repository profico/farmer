import { matchesSearch } from "@farmer/core/lib/search";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "#/components/ui/button.tsx";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxTrigger,
	ComboboxValue,
} from "#/components/ui/combobox.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	canQueryDeviceFamilies,
	isLocalFamily,
	localFamilyOf,
	localId,
	queryDeviceFamilies,
} from "#/lib/fonts.ts";

const noSubscribe = () => () => {};

/**
 * A font from this device, for one role. Where the browser has the Local Font
 * Access API (Chromium) a button lists the installed families after the person
 * allows it. Everywhere else, and when the person refuses, a text box takes a
 * family name: CSS finds any installed family by name.
 */
export function DeviceFontPicker({
	id,
	onPick,
}: {
	id: string;
	onPick: (id: string) => void;
}) {
	// False on the server and on the first client render, so hydration matches.
	const canList = useSyncExternalStore(
		noSubscribe,
		canQueryDeviceFamilies,
		() => false,
	);
	const [families, setFamilies] = useState<string[] | null>(null);
	const [typing, setTyping] = useState(false);
	const [note, setNote] = useState("");

	const load = async () => {
		setNote("");
		try {
			const found = await queryDeviceFamilies();
			if (found.length === 0) {
				setNote("This device reports no fonts. Type a family name instead.");
				setTyping(true);
				return;
			}
			setFamilies(found);
		} catch {
			setNote(
				"Permission to read fonts was refused. Type a family name instead.",
			);
			setTyping(true);
		}
	};

	if (families) {
		return (
			<FamilyList
				families={families}
				selected={localFamilyOf(id)}
				onPick={(family) => onPick(localId(family))}
			/>
		);
	}
	if (canList && !typing) {
		return (
			<div className="flex flex-col gap-1">
				<Button variant="outline" size="sm" onClick={() => void load()}>
					Use a font from this device
				</Button>
				<span className="text-xs text-faint">{note}</span>
			</div>
		);
	}
	return (
		<FamilyInput note={note} onPick={(family) => onPick(localId(family))} />
	);
}

function FamilyList({
	families,
	selected,
	onPick,
}: {
	families: string[];
	selected: string | null;
	onPick: (family: string) => void;
}) {
	const [query, setQuery] = useState("");
	const filtered = useMemo(
		() => families.filter((f) => matchesSearch(query, [f])),
		[families, query],
	);
	return (
		<Combobox
			items={families}
			filteredItems={filtered}
			value={selected}
			onValueChange={(family: string | null) => {
				if (family) onPick(family);
			}}
			inputValue={query}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				if (!open) setQuery("");
			}}
			autoHighlight
			defaultOpen
		>
			<ComboboxTrigger className="w-full sm:w-56">
				<ComboboxValue placeholder="Pick a device font" />
			</ComboboxTrigger>
			<ComboboxContent searchPlaceholder="Search fonts…">
				<ComboboxEmpty>No font matches.</ComboboxEmpty>
				<ComboboxList>
					{(family: string) => (
						<ComboboxItem
							key={family}
							value={family}
							// Each family passed `isLocalFamily`, so it has no quote to break out.
							style={{ fontFamily: `'${family}'` }}
						>
							<span className="truncate">{family}</span>
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

function FamilyInput({
	note,
	onPick,
}: {
	note: string;
	onPick: (family: string) => void;
}) {
	const [value, setValue] = useState("");
	const [error, setError] = useState("");
	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const family = value.trim();
		if (!isLocalFamily(family)) {
			setError("Use letters, digits, spaces, - _ and . only, up to 64.");
			return;
		}
		setError("");
		onPick(family);
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-1">
			<div className="flex gap-2">
				<Input
					value={value}
					onChange={(event) => setValue(event.target.value)}
					placeholder="Installed font name"
					aria-label="Installed font name"
					className="w-full sm:w-40"
				/>
				<Button type="submit" variant="outline" size="sm">
					Use
				</Button>
			</div>
			<span className="text-xs text-faint" aria-live="polite">
				{error || note}
			</span>
		</form>
	);
}
