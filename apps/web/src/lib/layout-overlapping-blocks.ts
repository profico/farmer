export type LayoutInterval = {
	startMinutes: number;
	durationMinutes: number;
};

export type LaidOutBlock<T> = {
	item: T;
	column: number;
	columnCount: number;
};

// Google-Calendar-style side-by-side layout: cluster overlapping intervals,
// then greedily assign each item to the first column whose previous item has
// already ended. Columns within a cluster all share that cluster's column
// count, so blocks size evenly instead of shrinking to a global max.
export function layoutOverlappingBlocks<T extends LayoutInterval>(
	items: T[],
): LaidOutBlock<T>[] {
	const sorted = [...items].sort((a, b) => a.startMinutes - b.startMinutes);
	const results: LaidOutBlock<T>[] = [];

	let cluster: T[] = [];
	let clusterEnd = Number.NEGATIVE_INFINITY;

	const flushCluster = () => {
		if (cluster.length === 0) return;
		const columnEndMinutes: number[] = [];
		const columnByItem = new Map<T, number>();

		for (const item of cluster) {
			let assignedColumn = -1;
			for (let col = 0; col < columnEndMinutes.length; col++) {
				if (
					(columnEndMinutes[col] ?? Number.NEGATIVE_INFINITY) <=
					item.startMinutes
				) {
					assignedColumn = col;
					break;
				}
			}
			if (assignedColumn === -1) {
				assignedColumn = columnEndMinutes.length;
				columnEndMinutes.push(0);
			}
			columnEndMinutes[assignedColumn] =
				item.startMinutes + item.durationMinutes;
			columnByItem.set(item, assignedColumn);
		}

		const columnCount = columnEndMinutes.length;
		for (const item of cluster) {
			results.push({
				item,
				column: columnByItem.get(item) ?? 0,
				columnCount,
			});
		}
		cluster = [];
	};

	for (const item of sorted) {
		if (item.startMinutes >= clusterEnd) {
			flushCluster();
			clusterEnd = item.startMinutes + item.durationMinutes;
		} else {
			clusterEnd = Math.max(
				clusterEnd,
				item.startMinutes + item.durationMinutes,
			);
		}
		cluster.push(item);
	}
	flushCluster();

	return results;
}
