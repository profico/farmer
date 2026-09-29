/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { isWellFormedSlug, RESERVED_SLUGS } from "@farmer/core/lib/slug";

// An organization lives at `/<slug>`, beside the app's own top-level pages.
// A new page whose name an organization could take would hide that
// organization's workspace, so each one must be in `RESERVED_SLUGS`.

/** The first path segment of each route file and directory. `__root` and
 *  `$orgSlug` are no slug, and neither is `[.]well-known`; `index` is `/`. */
const routeSegments = () =>
	readdirSync(join(import.meta.dir, "../routes"), { withFileTypes: true })
		.map((entry) =>
			entry.isDirectory() ? entry.name : entry.name.replace(/\.tsx?$/, ""),
		)
		.filter((name) => name !== "index" && isWellFormedSlug(name));

describe("RESERVED_SLUGS", () => {
	test("holds every top-level route", () => {
		const routes = routeSegments();
		expect(routes.length).toBeGreaterThan(0);
		for (const segment of routes) {
			expect({ segment, reserved: RESERVED_SLUGS.has(segment) }).toEqual({
				segment,
				reserved: true,
			});
		}
	});

	test("holds every top-level directory the host serves files from", () => {
		const publicDirs = readdirSync(join(import.meta.dir, "../../public"), {
			withFileTypes: true,
		})
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name);
		for (const segment of [...publicDirs, "assets"]) {
			expect({ segment, reserved: RESERVED_SLUGS.has(segment) }).toEqual({
				segment,
				reserved: true,
			});
		}
	});
});
