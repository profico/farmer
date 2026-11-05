import { describe, expect, test } from "bun:test";

import {
	fitsUploadLimit,
	MAX_UPLOAD_BASE64_LENGTH,
	resizeTarget,
} from "./limits";

describe("resizeTarget", () => {
	test("keeps a small image as it is", () => {
		expect(resizeTarget(200, 100, 256)).toBeNull();
		expect(resizeTarget(256, 256, 256)).toBeNull();
	});

	test("fits the longest side", () => {
		expect(resizeTarget(1000, 500, 256)).toEqual({ width: 256 });
		expect(resizeTarget(500, 1000, 256)).toEqual({ height: 256 });
	});
});

describe("fitsUploadLimit", () => {
	test("accepts the server's longest text and refuses one more", () => {
		expect(MAX_UPLOAD_BASE64_LENGTH).toBe(1_398_104);
		expect(fitsUploadLimit("A".repeat(MAX_UPLOAD_BASE64_LENGTH))).toBe(true);
		expect(fitsUploadLimit("A".repeat(MAX_UPLOAD_BASE64_LENGTH + 1))).toBe(
			false,
		);
	});
});
