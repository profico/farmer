import { CaretRightIcon } from "@phosphor-icons/react";
import { Fragment } from "react";

/**
 * A path through the menus, written in running text: "Settings › Hour fund".
 *
 * The separator is an icon, never a typed arrow (→, ›, ->). A glyph takes the
 * font's weight and baseline, so it never matches the icons beside it, and a
 * screen reader reads it out as "right arrow". The icon is hidden from a
 * screen reader, which hears the steps with a pause between them.
 */
export function MenuPath({ steps }: { steps: readonly string[] }) {
	return (
		<span className="whitespace-nowrap">
			{steps.map((step, index) => (
				<Fragment key={step}>
					{index > 0 && (
						<>
							<CaretRightIcon
								aria-hidden
								className="mx-0.5 inline size-[0.85em] align-[-0.1em]"
							/>
							<span className="sr-only">, </span>
						</>
					)}
					{step}
				</Fragment>
			))}
		</span>
	);
}
