/**
 * The icons of the workspace screens that `src/ui/icons.ts` does not have:
 * a Material icon on Android and an SF Symbol on iOS. Use an icon from
 * `src/ui/icons.ts` where one exists.
 */
export const WORKSPACE_ICONS = {
	copy: { md: "content-copy", sf: "doc.on.doc" },
	share: { md: "share", sf: "square.and.arrow.up" },
	archive: { md: "archive", sf: "archivebox" },
	restore: { md: "unarchive", sf: "arrow.uturn.backward" },
	send: { md: "send", sf: "paperplane" },
	mail: { md: "mail-outline", sf: "envelope" },
	filter: { md: "filter-list", sf: "line.3.horizontal.decrease.circle" },
	refresh: { md: "refresh", sf: "arrow.clockwise" },
	code: { md: "code", sf: "chevron.left.forwardslash.chevron.right" },
	chat: { md: "chat-bubble-outline", sf: "bubble.left" },
	download: { md: "file-download", sf: "square.and.arrow.down" },
	personAdd: { md: "person-add-alt", sf: "person.badge.plus" },
	lock: { md: "lock-outline", sf: "lock" },
	verified: { md: "verified", sf: "checkmark.seal" },
	more: { md: "more-vert", sf: "ellipsis.circle" },
} as const;

export type WorkspaceIconName = keyof typeof WORKSPACE_ICONS;
