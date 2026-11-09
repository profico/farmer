/**
 * Delete uploaded images that nothing uses any more.
 *
 * An upload saves nothing by itself (`uploadsService.uploadImage`), so a picker
 * closed without saving, a replaced icon and a cleared logo each leave an
 * object behind that counts against the bucket quota.
 *
 * Only `project.icon` and `organization.logo` can hold an upload path. Two
 * projects may use one file, so nothing is deleted at a replace: the sweep
 * asks whether any row still points at the object.
 *
 * Three rules keep it from deleting what it should not:
 *
 *   - An object younger than `UPLOAD_SWEEP_GRACE_MS` stays. The upload and the
 *     save that references it are two requests, and a picker may sit open.
 *   - Only keys of the upload shape count. The app did not put anything else
 *     in the bucket.
 *   - Only organizations in this database are swept. A development database
 *     on a bucket shared with production deletes nothing of production's. The
 *     files of a deleted organization stay too, which is cheaper than telling
 *     the two cases apart.
 *
 * The sweep lists the bucket before it reads the references, so a save that
 * lands during the listing is still seen. A client with a stale "Recently used"
 * image can still save a deleted path; that icon falls back to the initial.
 *
 * Only `orgs/` is listed, so the probe of the Infrastructure storage test
 * (under `instance/`) is never a candidate.
 */

import { inArray, like } from "drizzle-orm";

import { db } from "../db";
import { organization } from "../db/schema/auth";
import { project } from "../db/schema/domain";
import { objectStore } from "../lib/storage";
import {
	isUploadKey,
	UPLOAD_PATH_PREFIX,
	uploadKeyOf,
	uploadOrganizationOf,
} from "../lib/uploads";
import { reportJobFailure } from "./job-failures";

export const UPLOAD_SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

export type UploadSweepSummary = {
	enabled: boolean;
	listed: number;
	deleted: number;
	failed: number;
};

/** Every upload key a row points at, across the instance. The storage move
 *  guard (`instanceSettingsService.storageUsage`) counts the same set, so the
 *  warning and the sweep agree on what "in use" means. */
export const referencedUploadKeys = async (): Promise<Set<string>> => {
	const prefix = `${UPLOAD_PATH_PREFIX}%`;
	const [icons, logos] = await Promise.all([
		db
			.select({ value: project.icon })
			.from(project)
			.where(like(project.icon, prefix)),
		db
			.select({ value: organization.logo })
			.from(organization)
			.where(like(organization.logo, prefix)),
	]);
	const keys = new Set<string>();
	for (const { value } of [...icons, ...logos]) {
		const key = uploadKeyOf(value);
		if (key) keys.add(key);
	}
	return keys;
};

export const runUploadSweepOnce = async (
	options: {
		now?: Date;
		logger?: { warn: (message: string) => void };
	} = {},
): Promise<UploadSweepSummary> => {
	const store = objectStore();
	if (!store) return { enabled: false, listed: 0, deleted: 0, failed: 0 };

	const cutoff = (options.now ?? new Date()).getTime() - UPLOAD_SWEEP_GRACE_MS;
	let listed = 0;
	const old = new Map<string, string>();
	for await (const object of store.list("orgs/")) {
		listed += 1;
		const organizationId = isUploadKey(object.key)
			? uploadOrganizationOf(object.key)
			: null;
		if (organizationId && object.lastModified.getTime() < cutoff) {
			old.set(object.key, organizationId);
		}
	}
	if (old.size === 0) return { enabled: true, listed, deleted: 0, failed: 0 };

	const [referenced, known] = await Promise.all([
		referencedUploadKeys(),
		db
			.select({ id: organization.id })
			.from(organization)
			.where(inArray(organization.id, [...new Set(old.values())])),
	]);
	const knownIds = new Set(known.map((row) => row.id));

	let deleted = 0;
	let failed = 0;
	for (const [key, organizationId] of old) {
		if (referenced.has(key) || !knownIds.has(organizationId)) continue;
		try {
			// One at a time on purpose: a daily pass over a few files has no
			// deadline to meet.
			await store.delete(key);
			deleted += 1;
		} catch (error) {
			failed += 1;
			options.logger?.warn(`Upload sweep: ${String(error)}`);
			reportJobFailure({ job: "upload-sweep", error, organizationId });
		}
	}
	return { enabled: true, listed, deleted, failed };
};
