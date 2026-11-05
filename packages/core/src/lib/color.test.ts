import { expect, test } from "bun:test";

import { hexColor, safeColor } from "./color";

test("hexColor accepts a hex or a name and refuses CSS injection", () => {
	expect(hexColor.safeParse("#6B7f6a").success).toBe(true);
	expect(hexColor.safeParse("green").success).toBe(true);
	expect(hexColor.safeParse("red;position:fixed").success).toBe(false);
	expect(hexColor.safeParse("url(https://x.example/a.png)").success).toBe(
		false,
	);
});

test("safeColor falls back for a bad stored value", () => {
	expect(safeColor("#6b7f6a")).toBe("#6b7f6a");
	expect(safeColor("red;inset:0")).toBe("var(--muted-foreground)");
	expect(safeColor(null)).toBe("var(--muted-foreground)");
});
