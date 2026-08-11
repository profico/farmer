import type { ReactNode } from "react";

/**
 * The two-pane frame both auth screens sit in: a dark brand column on the left,
 * the form on the right.
 *
 * The brand column is the app's ink palette rendered literally — the same
 * values the stylesheet reserves for a dark theme, hard-coded here because this
 * panel is dark whatever the page around it is doing. It's the one place the
 * product shows its other face, which is why it can carry a serif line at a
 * size no other screen uses.
 */
const INK = {
	bg: "#15140f",
	fg: "#ede8de",
	mut: "#8f887c",
	acc: "#9178de",
};

export function AuthSplitPanel({
	tagline,
	brandContent,
	brand,
	children,
}: {
	tagline: string;
	brandContent?: ReactNode;
	/**
	 * Whitelabelling for single-org mode: the one organization's own name and
	 * logo replace the Profico mark, so an invite-only instance greets people
	 * with the company they were invited to rather than the vendor.
	 *
	 * Read live from the organization row (Settings → Organization), not from
	 * env vars — renaming the workspace rebrands the login screen.
	 */
	brand?: { name: string; logo: string | null } | null;
	children: ReactNode;
}) {
	return (
		<div className="flex min-h-svh items-center justify-center p-4 sm:p-8">
			{/* A hairline, not a shadow. The card is not floating over anything. */}
			<div className="flex w-full max-w-[900px] overflow-hidden rounded-2xl border">
				<div
					className="hidden w-[320px] shrink-0 flex-col p-8 md:flex"
					style={{ backgroundColor: INK.bg, color: INK.mut }}
				>
					{brand ? (
						// A logo when there is one; otherwise the name set as a wordmark,
						// at the mark's own height so the column's rhythm doesn't shift.
						brand.logo ? (
							<img
								src={brand.logo}
								alt={brand.name}
								className="h-6 w-auto max-w-[180px] object-contain object-left"
							/>
						) : (
							<span
								className="flex h-6 items-center text-base font-medium"
								style={{ color: INK.fg }}
							>
								{brand.name}
							</span>
						)
					) : (
						<img
							src="/profico-logo-white.svg"
							alt="Profico"
							className="h-6 w-auto"
						/>
					)}
					<div className="mt-auto">
						<p
							className="serif"
							style={{
								color: INK.fg,
								fontSize: 30,
								lineHeight: 1.15,
								letterSpacing: "-0.01em",
							}}
						>
							{tagline}
						</p>
						{brandContent}
					</div>
				</div>
				<div className="flex flex-1 bg-background flex-col justify-center px-5 py-8 sm:px-12 sm:py-10">
					{children}
				</div>
			</div>
		</div>
	);
}

/** Exposed so the register screen's feature list can match the panel. */
export const AUTH_INK = INK;
