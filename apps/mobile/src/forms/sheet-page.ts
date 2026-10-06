import { createContext, type ReactNode } from "react";

/** A page that a control pushes inside the sheet that holds it, with its
 *  own title, back button and search field in the bar of the sheet. */
export type SheetPage = {
	title: string;
	placeholder: string;
	onSearch: (search: string) => void;
	onBack: () => void;
	content: ReactNode;
};

/** The sheet gives the way to show a page. It is null outside a sheet of
 *  iOS, where a selector opens as a sheet of its own. */
export const SheetPageContext = createContext<
	((page: SheetPage | null) => void) | null
>(null);
