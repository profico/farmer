// Where every anchored popup is put, and why it is not just `<body>`.
//
// A popup is placed by arithmetic on `getBoundingClientRect`, which is in the
// viewport's own pixels. Preferences → Display → Scale is `zoom` on <html>
// (see `lib/scale.ts`), so a popup portalled into <body> is drawn inside that
// zoom and every offset it was given is multiplied by the scale a second time:
// at 150% a menu lands half its own distance further down the page, and the
// further down the trigger sits the further out it goes.
//
// So the popups go into one element that takes the zoom back off. Inside it a
// pixel is a viewport pixel again, which is what the positioning assumed, and
// the popup itself puts the zoom back on so that it is still drawn at the size
// the rest of the app is drawn at. `.popup-layer` and `.popup-scaled` in
// `styles.css` are the two halves, and the comment there carries the rest.
//
// At 100% — every device that never touches Scale — `calc(1 / 1)` is 1 and
// none of this does anything.

const ID = "popup-layer";

/** The layer, made on first use. Every `*.Portal` in `components/ui/` passes
 *  this as its `container`; a popup portalled anywhere else is placed correctly
 *  at 100% and nowhere near its trigger at any other scale. */
export const popupLayer = (): HTMLElement | null => {
	if (import.meta.env.SSR) return null;
	const existing = document.getElementById(ID);
	if (existing) return existing;
	const layer = document.createElement("div");
	layer.id = ID;
	layer.className = "popup-layer";
	document.body.appendChild(layer);
	return layer;
};
