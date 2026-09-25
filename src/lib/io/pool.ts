/** Brief decision 6: about four entities in flight. */
export const DEFAULT_CONCURRENCY = 4;

/**
 * Run `worker` over `items`, at most `limit` at once, results in item order. A worker that throws
 * rejects the whole pool: workers catch their own failures (one entity never stops the run).
 * `stop`, checked before each item is taken: once true, no new item starts; the ones in flight
 * finish, and the result holds only the items that ran, still in item order.
 */
export async function runPool<T, R>(
	items: T[],
	limit: number,
	worker: (item: T, i: number) => Promise<R>,
	stop?: () => boolean
): Promise<R[]> {
	const out = new Array<R>(items.length);
	const ran: boolean[] = new Array(items.length).fill(false);
	let next = 0;
	const lane = async () => {
		while (next < items.length && !stop?.()) {
			const i = next++;
			ran[i] = true;
			out[i] = await worker(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
	return stop ? out.filter((_, i) => ran[i]) : out;
}
