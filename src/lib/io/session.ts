/**
 * The apply and result screens' I/O, over apply.ts, revert.ts and the undo store: one read per
 * entity for the runner, a stored run opened for review or resume, an undo that closes its run
 * once nothing is left to undo. The screens' state lives in `$lib/app/apply.svelte.ts`.
 */

import type { SgClient } from 'sg-widgets-core';
import { remainingEntities, undoRecordsOf } from '$lib/pure/run';
import type { EntityRef, Run, Template, UndoRecord } from '$lib/pure/types';
import { recoverInterrupted, type ReadEntity } from './apply';
import { loadSnapshots } from './load';
import { revertRecords, type RevertDeps, type RevertOutcome } from './revert';
import type { UndoStore } from './undo-store';

/**
 * A fresh read of one entity, as the runner and the undo take it (`load.ts`'s `loadSnapshots`).
 * `template` names the policy fields to read; the undo reads edges only and may pass none.
 */
export function snapshotReader(client: SgClient, template: Template | null): ReadEntity {
	const t: Template = template ?? { id: 0, code: '', entityType: null, tasks: [], edges: [] };
	return async (entity: EntityRef) => {
		const [snap] = await loadSnapshots(client, [entity], t);
		if (!snap) throw new Error(`${entity.type} ${entity.id} was not found: it may have been deleted.`);
		return snap;
	};
}

/**
 * A stored run, opened after a reload or from another tab (brief 6): every entity left applying
 * with a prepared batch gets its record rebuilt from a fresh read first (`recoverInterrupted`), so
 * undo covers it and a re-plan skips it. `remaining`: what never landed.
 */
export async function openStoredRun(
	store: UndoStore,
	runId: string,
	read: ReadEntity
): Promise<{ run: Run; remaining: EntityRef[] } | null> {
	const stored = await store.loadRun(runId);
	if (!stored) return null;
	const run = stored.finishedAt === null ? await recoverInterrupted(stored, read, store) : stored;
	return { run, remaining: remainingEntities(run) };
}

/**
 * Undo `records`, about four entities at a time. Each entity the store knows is marked undone; a
 * stored run with nothing left to undo and nothing left to apply is then closed, so it stops
 * being offered on reopen.
 */
export async function undoRecords(
	records: UndoRecord[],
	deps: RevertDeps & { store: UndoStore; now?: () => string }
): Promise<RevertOutcome[]> {
	const outcomes = await revertRecords(records, deps);
	for (const runId of new Set(records.map((r) => r.runId))) {
		const run = await deps.store.loadRun(runId);
		if (run && run.finishedAt === null && undoRecordsOf(run).length === 0 && remainingEntities(run).length === 0)
			await deps.store.finishRun(runId, (deps.now ?? (() => new Date().toISOString()))());
	}
	return outcomes;
}
