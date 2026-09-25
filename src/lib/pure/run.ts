/**
 * Run bookkeeping for the I/O layer: which entities a run still owes, which undo records it holds,
 * how a thrown client error reads in a result. Pure, no I/O.
 */

import type { BatchRequest, EntityRef, EntityRunState, EntityTask, Run, UndoRecord } from './types';

/** One key per entity: type and id. */
export function entityKey(e: EntityRef): string {
	return `${e.type}:${e.id}`;
}

/** Nothing landed on these (brief 6, resume): pending, applying, or failed with no record. */
export function remainingEntities(run: Run): EntityRef[] {
	return run.entities
		.filter(({ status: s }) => s.state === 'pending' || s.state === 'applying' || (s.state === 'failed' && !s.undo))
		.map((e) => e.entity);
}

/** The records a download or an undo needs: every landed entity not undone yet. */
export function undoRecordsOf(run: Run): UndoRecord[] {
	return run.entities.flatMap(({ status: s }) =>
		(s.state === 'done' || s.state === 'failed') && s.undo ? [s.undo] : []
	);
}

/** The run with one entity's state replaced, or appended when the run did not list it. */
export function withEntityState(run: Run, entity: EntityRef, status: EntityRunState): Run {
	const key = entityKey(entity);
	const found = run.entities.some((e) => entityKey(e.entity) === key);
	const entities = found
		? run.entities.map((e) => (entityKey(e.entity) === key ? { entity: e.entity, status } : e))
		: [...run.entities, { entity, status }];
	return { ...run, entities };
}

/**
 * A thrown error as the result shows it. The client's `SgApiError` carries the first error's
 * `title` as its message (recipe 002: a rejected batch answers the failing request's title).
 */
export function errorOf(e: unknown): { status: number | null; message: string } {
	if (e instanceof Error) {
		const status = (e as { status?: unknown }).status;
		return { status: typeof status === 'number' ? status : null, message: e.message };
	}
	return { status: null, message: String(e) };
}

/** Dates each date-clearing request of the after-apply phase removes (097), from the read before it. */
export function clearedDatesFrom(reqs: BatchRequest[], tasks: EntityTask[]): UndoRecord['clearedDates'] {
	return reqs.flatMap((r) => {
		if (r.request_type !== 'update' || r.entity !== 'Task' || !('start_date' in r.data)) return [];
		const t = tasks.find((x) => x.id === r.record_id);
		return t ? [{ taskId: t.id, start: t.startDate, due: t.dueDate }] : [];
	});
}

/**
 * `fn` guarded against a second start: a call while one runs gets the running call's promise; the
 * next call after it settles, resolved or rejected, runs `fn` again.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
	let running: Promise<T> | null = null;
	return () => {
		if (running) return running;
		const p = fn().finally(() => {
			if (running === p) running = null;
		});
		running = p;
		return p;
	};
}
