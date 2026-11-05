import { describe, expect, test } from "bun:test";

import { uploadImageInput } from "../schema/uploads";
import {
	bytesFromBase64,
	isUploadedFile,
	MAX_UPLOAD_BYTES,
	sniffImage,
	uploadContentType,
	uploadKey,
	uploadKeyOf,
	uploadOrganizationOf,
	uploadPath,
} from "./uploads";

const ID = "3f2a9b1c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("sniffImage", () => {
	test("reads the type from the bytes", () => {
		expect(
			sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
		).toBe("png");
		expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("jpg");
		expect(sniffImage(text("GIF89a"))).toBe("gif");
		expect(sniffImage(text("RIFF\0\0\0\0WEBPVP8 "))).toBe("webp");
		expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
			"svg",
		);
		expect(
			sniffImage(
				text('﻿<?xml version="1.0"?>\n<!-- a logo -->\n<svg viewBox="0 0 1 1">'),
			),
		).toBe("svg");
	});

	test("refuses what only claims to be an image", () => {
		expect(sniffImage(text("<html><body>not a logo</body></html>"))).toBeNull();
		expect(sniffImage(text("%PDF-1.7"))).toBeNull();
		expect(sniffImage(text("RIFF\0\0\0\0WAVE"))).toBeNull();
		expect(sniffImage(bytes())).toBeNull();
	});
});

describe("upload paths", () => {
	const key = uploadKey("org_1", "project-icon", ID, "png");

	test("a key round-trips through its path", () => {
		expect(uploadKeyOf(uploadPath(key))).toBe(key);
		expect(isUploadedFile(uploadPath(key))).toBe(true);
		expect(uploadOrganizationOf(key)).toBe("org_1");
		expect(uploadContentType(key)).toBe("image/png");
	});

	test("an emoji, a URL and a path of the wrong shape are not uploads", () => {
		expect(isUploadedFile("🚜")).toBe(false);
		expect(isUploadedFile("https://example.com/logo.svg")).toBe(false);
		expect(isUploadedFile(null)).toBe(false);
		expect(
			isUploadedFile(`/api/files/orgs/org_1/project-icon/${ID}.html`),
		).toBe(false);
		expect(isUploadedFile(`/api/files/orgs/org_1/avatar/${ID}.png`)).toBe(
			false,
		);
		expect(isUploadedFile("/api/files/orgs/../../etc/passwd")).toBe(false);
		expect(uploadContentType(`orgs/org_1/org-logo/${ID}.exe`)).toBeNull();
	});
});

describe("an upload as base64", () => {
	const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

	test("gives back the bytes it was made from", () => {
		const data = Buffer.from(PNG).toString("base64");
		expect([...bytesFromBase64(data)]).toEqual(PNG);
		expect(sniffImage(bytesFromBase64(data))).toBe("png");
	});

	test("the schema takes a file of the size limit", () => {
		const data = Buffer.alloc(MAX_UPLOAD_BYTES).toString("base64");
		expect(
			uploadImageInput.safeParse({ purpose: "org-logo", data }).success,
		).toBe(true);
	});

	test("the schema refuses a file larger than the limit", () => {
		const data = Buffer.alloc(MAX_UPLOAD_BYTES + 3).toString("base64");
		expect(
			uploadImageInput.safeParse({ purpose: "org-logo", data }).success,
		).toBe(false);
	});

	test("the schema refuses text that is not base64", () => {
		for (const data of ["iVBO*w0K", "data:image/png;base64,iVBORw0K", "abc"]) {
			expect(
				uploadImageInput.safeParse({ purpose: "project-icon", data }).success,
			).toBe(false);
		}
	});
});
