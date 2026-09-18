import { cn } from "#/lib/utils.ts";

// Google Calendar's own mark, in its own colours, so a row that came from the
// calendar reads as such at a glance — a grey calendar glyph only says "a
// date". Drawn inline (four frame bars and the folded corner) rather than
// loaded, so it needs no asset and renders identically in both themes; the
// centre is left plain because the "31" does not survive 16 pixels.
//
// Brand colours are literal on purpose: they are Google's, not ours, and must
// not follow the theme.
export function GoogleCalendarMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 24 24"
			aria-hidden="true"
			className={cn("size-4 shrink-0", className)}
		>
			<rect x="6" y="6" width="12" height="12" fill="#ffffff" />
			<path d="M2 6h16v4H2z" fill="#4285f4" />
			<path d="M2 6h4v12H2z" fill="#4285f4" />
			<path d="M18 10v8h-4v-8z" fill="#fbbc04" />
			<path d="M6 18h8v4H6z" fill="#34a853" />
			<path d="M2 18h4v4z" fill="#1967d2" />
			<path d="M18 6h4v4h-4z" fill="#1967d2" />
			<path d="M14 18h4l-4 4z" fill="#ea4335" />
		</svg>
	);
}
