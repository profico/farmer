import { describe, expect, test } from "bun:test";

import { parseListObjects } from "./storage";

describe("parseListObjects", () => {
	test("reads the keys, their dates and the next page", () => {
		const page = parseListObjects(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Name>farmer</Name>
  <Prefix>orgs/</Prefix>
  <KeyCount>2</KeyCount>
  <IsTruncated>true</IsTruncated>
  <NextContinuationToken>b3Jncy9h+/=</NextContinuationToken>
  <Contents>
    <Key>orgs/a/org-logo/one.png</Key>
    <LastModified>2026-09-14T12:54:00.000Z</LastModified>
    <ETag>"abc"</ETag>
    <Size>12</Size>
  </Contents>
  <Contents>
    <Key>orgs/a/notes &amp; more.txt</Key>
    <LastModified>2026-09-13T08:00:00.000Z</LastModified>
  </Contents>
</ListBucketResult>`);

		expect(page.objects).toEqual([
			{
				key: "orgs/a/org-logo/one.png",
				lastModified: new Date("2026-09-14T12:54:00.000Z"),
			},
			{
				key: "orgs/a/notes & more.txt",
				lastModified: new Date("2026-09-13T08:00:00.000Z"),
			},
		]);
		expect(page.next).toBe("b3Jncy9h+/=");
	});

	test("the last page has no next token, and an empty bucket no objects", () => {
		expect(
			parseListObjects(
				"<ListBucketResult><IsTruncated>false</IsTruncated><NextContinuationToken>stale</NextContinuationToken></ListBucketResult>",
			),
		).toEqual({ objects: [], next: null });
	});
});
