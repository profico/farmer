import { useEffect, useRef } from "react";

import { mountWheatField } from "#/lib/wheat-field.ts";

/**
 * The strip of wheat under the footer: three rows of stalks, grey with a few
 * in the accent, that sway, bend in a gust now and then, and bend away from
 * the pointer. The drawing is `lib/wheat-field.ts`.
 */
export function WheatField() {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		if (!canvas) return;
		const field = mountWheatField(canvas, {
			// `.fm-footer-field` sets the same height.
			height: 160,
			seed: 7,
			density: 14,
			shortest: 50,
			tallest: 140,
			tone: "--faint",
			accent: "--acc",
			accentShare: 0.14,
			opacity: [0.35, 0.9],
			wind: true,
			gusts: true,
		});
		return field?.dispose;
	}, []);
	return <canvas ref={ref} className="fm-footer-field" aria-hidden />;
}
