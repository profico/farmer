/**
 * Delete uploaded images that nothing uses any more.
 *
 * An upload saves nothing by itself (`uploadsService.uploadImage`), so a picker
 * closed without saving, a replaced icon and a cleared logo each leave an
 * object behind. The bucket has a quota, and those objects count against it.
 *
 * What still counts as used is read from the only two columns that can hold an
 * upload path: `project.icon` and `organization.logo`. Two projects may wear one
 * file ("Recently used" offers other projects' images), which is why nothing is
 * deleted at the moment of a replace — the sweep asks whether ANY row still
 * points at it.
 *
 * Three rules keep it from deleting what it should not:
 *
 *   - An object younger than `UPLOAD_SWEEP_GRACE_MS` stays. The upload and the
 *     save that references it are two requests, and a picker may sit open.
 *   - Only keys of the upload shape are considered. Anything else in the bucket
 *     was not put there by this app.
 *   - Only organizations this database knows are swept. A development database
 *     pointed at a bucket that production also uses sees none of production's
 *     organizations, so it deletes nothing of theirs. The same rule keeps the
 *     files of a deleted organization, since its row is gone too; at 1 MB each
 *     that is cheaper than telling the two cases apart.
 *
 * The bucket is listed BEFORE the references are read, so a save that lands
 * while the listing runs is still seen. A client holding a stale "Recently used"
 * image can still save a path this sweep has just deleted; that icon then falls
 * back to the project's initial.
 *
 * Only `orgs/` is listed, so the probe the Infrastructure page's storage test
 * writes (under `instance/`) is never a candidate, even if its delete failed.
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
		}
	}
	return { enabled: true, listed, deleted, failed };
};
