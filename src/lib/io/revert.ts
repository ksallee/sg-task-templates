/**
 * Undo one run's entities from their records (IndexedDB or an uploaded file). Thin over undo.ts:
 *   1. revive the Tasks the apply deleted, one call each, FIRST (103, 110: before the old
 *      template's write, or it makes a new Task and the revive leaves two);
 *   2. read the edges live, then `buildRevert`'s one `_batch` (104: it deletes only rows it read;
 *      a gone one 404s the whole batch);
 *   3. read the edges again, then `buildEdgeRevert`: the remove batch, each edge revive (095),
 *      then the create batch for erased rows (101, 109, 111: by pair, from the before-snapshot).
 * A failure stops that entity only, with the client's error title verbatim. Rerunning an entity is
 * safe: a revive of a live row answers false, and both builders work from a fresh read.
 */

import type { SgClient } from 'sg-widgets-core';
import { buildEdgeRevert, buildRevert } from '$lib/pure/undo';
import { errorOf } from '$lib/pure/run';
import type { Edge, EntityRef, Id, UndoNote, UndoRecord } from '$lib/pure/types';
import { DEFAULT_CONCURRENCY, runPool } from './pool';
import type { ReadEntity } from './apply';
import type { UndoStore } from './undo-store';

export interface RevertDeps {
	client: Pick<SgClient, 'batch' | 'revive'>;
	read: ReadEntity;
	/** Marks each reverted entity `undone` in its run. Absent for a file with no stored run. */
	store?: UndoStore;
	concurrency?: number;
	onProgress?: (p: { entity: EntityRef; finished: number; total: number }) => void;
}

export type RevertStage = 'revive_tasks' | 'read' | 'batch' | 'edges';

export type RevertOutcome =
	| {
			kind: 'ok';
			entity: EntityRef;
			notes: UndoNote[];
			/** Live edges the record does not know (someone else, the old template's re-sync): left. */
			left: Array<Edge & { id: Id }>;
	  }
	| { kind: 'failed'; entity: EntityRef; stage: RevertStage; error: { status: number | null; message: string } };

const liveEdges = async (read: ReadEntity, entity: EntityRef) => (await read(entity)).edges;

/** One entity. Never throws. */
export async function revertEntity(rec: UndoRecord, deps: RevertDeps): Promise<RevertOutcome> {
	const { client, read } = deps;
	const entity = rec.entity;
	let stage: RevertStage = 'revive_tasks';
	try {
		for (const id of rec.deletedTasks) await client.revive('Task', id);

		stage = 'read';
		const plan = buildRevert(rec, await liveEdges(read, entity));
		stage = 'batch';
		if (plan.batch.length) await client.batch(plan.batch);

		stage = 'read';
		const edges = buildEdgeRevert(rec, await liveEdges(read, entity));
		stage = 'edges';
		if (edges.remove.length) await client.batch(edges.remove);
		for (const id of edges.revive) await client.revive('TaskDependency', id);
		if (edges.create.length) await client.batch(edges.create);

		await deps.store?.saveEntity(rec.runId, entity, { state: 'undone', undo: rec });
		return { kind: 'ok', entity, notes: plan.notes, left: edges.left };
	} catch (e) {
		return { kind: 'failed', entity, stage, error: errorOf(e) };
	}
}

/** Every record, `concurrency` at a time (brief 6). Outcomes in record order. */
export async function revertRecords(records: UndoRecord[], deps: RevertDeps): Promise<RevertOutcome[]> {
	const total = records.length;
	let finished = 0;
	return runPool(records, deps.concurrency ?? DEFAULT_CONCURRENCY, async (rec) => {
		const outcome = await revertEntity(rec, deps);
		finished++;
		deps.onProgress?.({ entity: rec.entity, finished, total });
		return outcome;
	});
}
