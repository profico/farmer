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

export type ObjectStore = {
	put: (
		key: string,
		bytes: Uint8Array<ArrayBuffer>,
		contentType: string,
	) => Promise<void>;
	/** Null when there is no such object. */
	get: (key: string) => Promise<StoredObject | null>;
};

export class ObjectStoreError extends Error {}

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
	const base = `${config.endpoint.replace(/\/+$/, "")}/${config.bucket}/`;
	const send = async (key: string, init: RequestInit) =>
		externalFetch(await client.sign(base + key, init));

	return {
		put: async (key, bytes, contentType) => {
			const response = await send(key, {
				method: "PUT",
				body: bytes,
				headers: { "content-type": contentType },
			});
			await response.body?.cancel();
			if (!response.ok) {
				throw new ObjectStoreError(`Storing ${key} failed: ${response.status}`);
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
