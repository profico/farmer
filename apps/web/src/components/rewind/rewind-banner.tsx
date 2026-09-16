import { featuredRewindYear } from "@farmer/core/lib/rewind";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

// The home page's way in to the Rewind, through December and January only
// (`featuredRewindYear`). Outside those months `/rewind` still opens last
// year's, but nothing on the home page asks for attention about it.
export function RewindBanner({
	orgSlug,
	today,
}: {
	orgSlug: string;
	today: string;
}) {
	const year = featuredRewindYear(today);
	if (year === null) return null;
	const inProgress = year === Number(today.slice(0, 4));
	return (
		<Link
			to="/$orgSlug/rewind"
			params={{ orgSlug }}
			search={{ year }}
			// A strip between hairlines rather than a gradient card: the page is
			// the only island and nothing inside it is a box. The year in the
			// display face and the accent is what still makes it the Rewind.
			className="group mb-6 flex items-center gap-4 border-y border-line py-3.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/16"
		>
			<span className="serif shrink-0 text-4xl leading-none text-primary">
				{year}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-base font-medium">Your Farmer Rewind is here</p>
				<p className="text-sm text-muted-foreground">
					{inProgress
						? "Your year in hours, with the rest of December projected."
						: "Your year in hours, rewound."}
				</p>
			</div>
			<ArrowRightIcon className="size-5 shrink-0 text-primary transition-transform duration-(--dur-base) group-hover:translate-x-0.5" />
		</Link>
	);
}
