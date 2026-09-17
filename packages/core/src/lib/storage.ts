/**
 * The object store uploads live in — any S3-compatible service. Deployments run
 * Garage (see docker-compose.yml for development), but nothing here is
 * Garage-specific.
 *
 * Signed with `aws4fetch` rather than `Bun.S3Client`, because `vite dev` runs
 * server functions under Node (see vite.config.ts), and sent through
 * `externalFetch`, so a store that stops answering costs one upload rather than
 * a request that never ends.
 *
 * Optional. With any of the four required variables missing, `objectStore()`
 * is null: the upload controls do not render, the upload server function
 * refuses, and `/api/files` answers 404. Read per call, like `lib/mcp-flag.ts`.
 */
import { AwsClient } from "aws4fetch";

import { externalFetch } from "./http";

export type StoredObject = {
	body: ReadableStream<Uint8Array>;
	size: number | null;
};

export type ListedObject = { key: string; lastModified: Date };

/** One page of a listing; `next` is null on the last page. */
export type ListedPage = { objects: ListedObject[]; next: string | null };

export type ObjectStore = {
	put: (
		key: string,
		bytes: Uint8Array<ArrayBuffer>,
		contentType: string,
	) => Promise<void>;
	/** Null when there is no such object. */
	get: (key: string) => Promise<StoredObject | null>;
	/** Every object whose key starts with `prefix`, fetched a page at a time. */
	list: (prefix: string) => AsyncIterable<ListedObject>;
	/** Also succeeds when the object is already gone. */
	delete: (key: string) => Promise<void>;
};

export class ObjectStoreError extends Error {}

/** The store refused a write because the bucket is at its quota. */
export class ObjectStoreFullError extends ObjectStoreError {}

let storeForTests: ObjectStore | null | undefined;

/** Substitute the store for a test file. `undefined` restores the one the
 *  environment describes; `null` is a deployment with no store at all. */
export const setObjectStoreForTests = (
	store: ObjectStore | null | undefined,
) => {
	storeForTests = store;
};

export const objectStore = (): ObjectStore | null => {
	if (storeForTests !== undefined) return storeForTests;
	const endpoint = process.env.S3_ENDPOINT?.trim();
	const bucket = process.env.S3_BUCKET?.trim();
	const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

	if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

	return s3Store({
		endpoint,
		bucket,
		accessKeyId,
		secretAccessKey,
		region: process.env.S3_REGION?.trim() || "us-east-1",
	});
};

export const isStorageEnabled = (): boolean => objectStore() !== null;

const XML_ENTITIES = new Map([
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["amp", "&"],
]);

const unescapeXml = (text: string) =>
	text.replace(/&(lt|gt|quot|apos|amp);/g, (entity, name: string) => {
		return XML_ENTITIES.get(name) ?? entity;
	});

const element = (xml: string, name: string) => {
	const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);

	return match ? unescapeXml(match[1] ?? "") : null;
};

/**
 * One page of a ListObjectsV2 answer. Read with patterns rather than an XML
 * parser: the answer is flat, S3 escapes every value, and the three elements
 * read here never nest.
 */
export const parseListObjects = (xml: string): ListedPage => {
	const objects: ListedObject[] = [];

	for (const [, contents = ""] of xml.matchAll(
		/<Contents>([\s\S]*?)<\/Contents>/g,
	)) {
		const key = element(contents, "Key");
		const lastModified = new Date(element(contents, "LastModified") ?? "");

		if (key && !Number.isNaN(lastModified.getTime())) {
			objects.push({ key, lastModified });
		}
	}

	const truncated = element(xml, "IsTruncated") === "true";

	return {
		objects,
		next: truncated ? element(xml, "NextContinuationToken") : null,
	};
};

const s3Store = (config: {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
}): ObjectStore => {
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: "s3",
		region: config.region,
	});

	// Path-style (endpoint/bucket/key): Garage and MinIO answer it without a DNS
	// name per bucket. Every key is [A-Za-z0-9/._-], so nothing needs encoding.
	const bucket = `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}`;

	const signed = async (url: string, init: RequestInit) =>
		externalFetch(await client.sign(url, init));

	const send = (key: string, init: RequestInit) =>
		signed(`${bucket}/${key}`, init);

	return {
		put: async (key, bytes, contentType) => {
			const response = await send(key, {
				method: "PUT",
				body: bytes,
				headers: { "content-type": contentType },
			});

			if (response.ok) {
				await response.body?.cancel();

				return;
			}

			const detail = await response.text();

			// S3 has no status of its own for a full bucket. Garage answers 403
			// AccessDenied with "Bucket size quota is reached" (or "Object quota"),
			// and a 403 without the word is a real credential problem.
			if (response.status === 403 && /quota/i.test(detail)) {
				throw new ObjectStoreFullError(`Storing ${key} failed: ${detail}`);
			}

			throw new ObjectStoreError(`Storing ${key} failed: ${response.status}`);
		},
		list: async function* (prefix) {
			let continuation: string | null = null;

			do {
				const url = new URL(bucket);
				url.searchParams.set("list-type", "2");
				url.searchParams.set("prefix", prefix);

				if (continuation) {
					url.searchParams.set("continuation-token", continuation);
				}

				const response = await signed(url.toString(), { method: "GET" });

				if (!response.ok) {
					await response.body?.cancel();
					throw new ObjectStoreError(
						`Listing ${prefix} failed: ${response.status}`,
					);
				}

				const page = parseListObjects(await response.text());
				yield* page.objects;
				continuation = page.next;
			} while (continuation);
		},
		delete: async (key) => {
			const response = await send(key, { method: "DELETE" });
			await response.body?.cancel();

			if (!response.ok && response.status !== 404) {
				throw new ObjectStoreError(
					`Deleting ${key} failed: ${response.status}`,
				);
			}
		},
		get: async (key) => {
			const response = await send(key, { method: "GET" });

			if (response.status === 404) {
				await response.body?.cancel();

				return null;
			}

			if (!response.ok || !response.body) {
				await response.body?.cancel();
				throw new ObjectStoreError(`Reading ${key} failed: ${response.status}`);
			}

			const size = Number(response.headers.get("content-length"));

			return {
				body: response.body,
				size: Number.isInteger(size) && size > 0 ? size : null,
			};
		},
	};
};
