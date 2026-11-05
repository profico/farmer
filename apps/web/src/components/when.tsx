import { useRouteContext } from "@tanstack/react-router";

/**
 * A timestamp in the organization's timezone, like every other time in the app.
 *
 * The server renders the page first and the browser hydrates it, so the text
 * must not depend on the clock settings of either machine.
 */
export function When({ date }: { date: Date | string }) {
	const timeZone = useRouteContext({
		from: "/$orgSlug",
		select: (context) => context.organization.timezone,
	});
	const value = new Date(date);
	return (
		<time dateTime={value.toISOString()}>
			{value.toLocaleString("en-US", {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone,
			})}
		</time>
	);
}
