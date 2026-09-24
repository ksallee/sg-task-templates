/** Brief decision 6: about four entities in flight. */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Run `worker` over `items`, at most `limit` at once, results in item order. A worker that throws
 * rejects the whole pool: workers catch their own failures (one entity never stops the run).
 */
export async function runPool<T, R>(items: T[], limit: number, worker: (item: T, i: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let next = 0;
	const lane = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await worker(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
	return out;
}
