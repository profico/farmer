/** A chat message as plain text: no fences, directives or markdown marks. */
export const plainText = (markdown: string): string =>
	markdown
		.replace(/```[\s\S]*?(```|$)/g, " ")
		.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/\*+|(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, "")
		.replace(/\|/g, " ")
		.replace(/\s+/g, " ")
		.trim();
