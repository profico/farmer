import {
	createContext,
	type ReactNode,
	use,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { HeaderActions } from "../navigation/header-actions";

/**
 * One Save for a screen of several independent settings, as iOS draws it:
 * a bold button in the navigation bar, on while some setting has changed.
 * Each setting form reports its own state with `useSaveBar`, and keeps its
 * own server call. The bar runs the calls of the settings that changed.
 */
type Register = (id: string, dirty: boolean, save: () => void) => void;

const SaveBarContext = createContext<Register | null>(null);

export function SaveBar({
	busy,
	children,
}: {
	busy?: boolean;
	children: ReactNode;
}) {
	const [dirty, setDirty] = useState<Record<string, boolean>>({});
	const saves = useRef<Record<string, () => void>>({});
	const register = useCallback<Register>((id, isDirty, save) => {
		saves.current[id] = save;
		setDirty((current) =>
			current[id] === isDirty ? current : { ...current, [id]: isDirty },
		);
	}, []);
	const changed = Object.entries(dirty).filter(([, isDirty]) => isDirty);
	const saveAll = () => {
		for (const [id] of changed) saves.current[id]?.();
	};
	return (
		<SaveBarContext value={register}>
			<HeaderActions
				actions={[
					{
						label: "Save",
						prominent: true,
						disabled: busy || changed.length === 0,
						onPress: saveAll,
					},
				]}
			/>
			{children}
		</SaveBarContext>
	);
}

/** Reports a setting to the `SaveBar` above it. `save` runs from the bar. */
export function useSaveBar(id: string, dirty: boolean, save: () => void) {
	const register = use(SaveBarContext);
	const latest = useRef(save);
	useEffect(() => {
		latest.current = save;
	});
	useEffect(() => {
		register?.(id, dirty, () => latest.current());
	}, [register, id, dirty]);
}
