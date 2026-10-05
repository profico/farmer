/**
 * Every icon the app draws, by role: a Material icon on Android and an SF
 * Symbol on iOS. Text never carries an arrow or a check mark; an icon does.
 */
export const ICONS = {
	add: { md: "add", sf: "plus" },
	back: { md: "chevron-left", sf: "chevron.left" },
	forward: { md: "chevron-right", sf: "chevron.right" },
	play: { md: "play-arrow", sf: "play.fill" },
	pause: { md: "pause", sf: "pause.fill" },
	stop: { md: "stop", sf: "stop.fill" },
	delete: { md: "delete-outline", sf: "trash" },
	edit: { md: "edit", sf: "pencil" },
	check: { md: "check", sf: "checkmark" },
	close: { md: "close", sf: "xmark" },
	search: { md: "search", sf: "magnifyingglass" },
	folder: { md: "folder-open", sf: "folder" },
	timer: { md: "timer", sf: "timer" },
	inbox: { md: "inbox", sf: "tray" },
	error: { md: "error-outline", sf: "exclamationmark.triangle" },
	offline: { md: "cloud-off", sf: "icloud.slash" },
	server: { md: "dns", sf: "server.rack" },
	person: { md: "person-outline", sf: "person.crop.circle" },
	workspace: { md: "workspaces-outline", sf: "square.grid.2x2" },
	web: { md: "open-in-new", sf: "safari" },
	signOut: { md: "logout", sf: "rectangle.portrait.and.arrow.right" },
	key: { md: "vpn-key", sf: "key" },
	browser: { md: "language", sf: "globe" },
	info: { md: "info-outline", sf: "info.circle" },
	minus: { md: "remove", sf: "minus" },
	calendar: { md: "event", sf: "calendar" },
} as const;

export type IconName = keyof typeof ICONS;
