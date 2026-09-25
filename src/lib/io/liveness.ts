/**
 * Which runs a tab is applying right now, across the tabs of one browser: the applying tab holds a
 * Web Lock named after the run for as long as it writes, and the browser drops it when the tab
 * closes. A stored run with no finish and no lock is dead: its reopen recovers it (brief 6). A run
 * whose lock is held is live elsewhere: nothing recovers or re-plans it. Without Web Locks every
 * run reads as not live, as before.
 */

export interface Locks {
	request<T>(name: string, cb: () => Promise<T>): Promise<T>;
	query(): Promise<{ held?: Array<{ name?: string }> }>;
}

const PREFIX = 'sg-task-templates:run:';

const browserLocks = (): Locks | undefined => (globalThis.navigator as { locks?: Locks } | undefined)?.locks;

/** Run `work` holding the run's lock. */
export function holdRun<T>(runId: string, work: () => Promise<T>, locks: Locks | undefined = browserLocks()): Promise<T> {
	return locks ? locks.request(PREFIX + runId, work) : work();
}

/** The ids of the runs some tab holds the lock of now. */
export async function liveRuns(locks: Locks | undefined = browserLocks()): Promise<Set<string>> {
	if (!locks) return new Set();
	try {
		const { held = [] } = await locks.query();
		return new Set(held.flatMap((l) => (l.name?.startsWith(PREFIX) ? [l.name.slice(PREFIX.length)] : [])));
	} catch {
		return new Set();
	}
}
