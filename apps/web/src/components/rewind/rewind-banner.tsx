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
			className="group mb-4 flex items-center gap-4 overflow-hidden rounded-lg px-5 py-4 text-[#fbf8ff] transition-[filter] duration-(--dur-base) hover:brightness-110"
			style={{
				background:
					"linear-gradient(115deg, #5b3aa8 0%, #22418f 62%, #cf553f 100%)",
			}}
		>
			<span className="serif shrink-0 text-4xl leading-none text-[#ffd27a]">
				{year}
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-base font-medium">Your Farmer Rewind is here</p>
				<p className="text-sm opacity-80">
					{inProgress
						? "Your year in hours, with the rest of December projected."
						: "Your year in hours, rewound."}
				</p>
			</div>
			<ArrowRightIcon className="size-5 shrink-0 transition-transform duration-(--dur-base) group-hover:translate-x-0.5" />
		</Link>
	);
}
