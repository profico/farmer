/**
 * Write one secure item again, so that it gets new accessibility. A write
 * over an existing item changes the value only, so the item is deleted
 * first. The value is in memory between the delete and the write: the write
 * follows at once, and a failed write is tried one more time.
 *
 * Returns true when the item is as it should be: absent, or written again.
 * Returns false when a step failed, so that the caller leaves its "done"
 * flag unset and the next launch tries again. Never throws.
 */
export const rewriteItem = async (item: {
	read: () => Promise<string | null>;
	remove: () => Promise<void>;
	write: (value: string) => Promise<void>;
}): Promise<boolean> => {
	let value: string | null;
	try {
		value = await item.read();
	} catch {
		return false;
	}
	if (value === null) return true;
	try {
		await item.remove();
	} catch {
		// The item is still there, with its old accessibility.
		return false;
	}
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			await item.write(value);
			return true;
		} catch {
			// Try one more time.
		}
	}
	return false;
};
