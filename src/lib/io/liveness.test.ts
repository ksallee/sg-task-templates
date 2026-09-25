import { describe, expect, it } from 'vitest';
import { holdRun, liveRuns, type Locks } from './liveness';

/** Web Locks as the browser keeps them: held while the callback runs. */
function fakeLocks(): Locks {
	const held = new Set<string>();
	return {
		async request(name, cb) {
			held.add(name);
			try {
				return await cb();
			} finally {
				held.delete(name);
			}
		},
		async query() {
			return { held: [...held].map((name) => ({ name })), pending: [] } as never;
		}
	};
}

describe('liveness', () => {
	it('a run is live while a tab applies it, and dead after', async () => {
		const locks = fakeLocks();
		let during = new Set<string>();
		const out = await holdRun(
			'r1',
			async () => {
				during = await liveRuns(locks);
				return 7;
			},
			locks
		);
		expect(out).toBe(7);
		expect([...during]).toEqual(['r1']);
		expect([...(await liveRuns(locks))]).toEqual([]);
	});

	it('without Web Locks nothing reads as live and the work runs', async () => {
		expect(await holdRun('r1', async () => 1, undefined)).toBe(1);
		expect((await liveRuns(undefined)).size).toBe(0);
	});
});
