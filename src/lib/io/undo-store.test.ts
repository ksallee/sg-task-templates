import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { EntityRef, EntitySnapshot, Run, UndoRecord } from '$lib/pure/types';
import { openUndoStore, readUndoFile, undoFileBlob } from './undo-store';

const shot = (id: number): EntityRef => ({ type: 'Shot', id });

function record(runId: string, id: number): UndoRecord {
	return {
		version: 1,
		runId,
		entity: shot(id),
		templateId: 5,
		appliedAt: '2026-09-24T10:00:00Z',
		previousTaskTemplate: null,
		claimed: [{ taskId: 11, previousTemplateTask: null }],
		created: [12],
		fieldValues: [],
		omitted: [],
		deletedTasks: [],
		droppedEdges: [],
		recreatedEdges: [],
		deletedEdges: [],
		addedEdges: [],
		clearedDates: []
	};
}

function run(id: string, startedAt: string, n = 2): Run {
	return {
		version: 1,
		id,
		project: { type: 'Project', id: 1 },
		template: { id: 5, code: 'tt' },
		entryPoint: 'entities_first',
		user: { type: 'HumanUser', id: 9 },
		options: {
			fieldPolicies: {},
			extraByName: {},
			extraOverrides: {},
			omitStatus: 'omt',
			conflictPicks: {},
			edgeActions: {},
			clearCreatedDates: false,
		},
		startedAt,
		finishedAt: null,
		entities: Array.from({ length: n }, (_, i) => ({ entity: shot(i + 1), status: { state: 'pending' as const } }))
	};
}

const snapshot = (id: number): EntitySnapshot => ({
	entity: { ...shot(id), entityType: 'Shot', taskTemplate: null },
	tasks: [],
	edges: [],
	usage: {},
	readAt: '2026-09-24T10:00:00Z'
});

describe('undo store on IndexedDB', () => {
	it('keeps runs and per-entity records across a reopen', async () => {
		const idb = new IDBFactory();
		const a = await openUndoStore(idb);
		expect(a.persistent).toBe(true);
		await a.saveRun(run('r1', '2026-09-24T10:00:00Z'));
		await a.saveEntity('r1', shot(1), { state: 'done', undo: record('r1', 1) });

		const b = await openUndoStore(idb);
		const loaded = await b.loadRun('r1');
		expect(loaded?.entities).toEqual([
			{ entity: shot(1), status: { state: 'done', undo: record('r1', 1) } },
			{ entity: shot(2), status: { state: 'pending' } }
		]);
	});

	it('reads a run saved with the old deleteConfirmed option', async () => {
		const idb = new IDBFactory();
		const a = await openUndoStore(idb);
		const old = run('r0', '2026-09-24T10:00:00Z');
		await a.saveRun({ ...old, options: { ...old.options, deleteConfirmed: true } as Run['options'] });
		const loaded = await (await openUndoStore(idb)).loadRun('r0');
		expect(loaded?.options.omitStatus).toBe('omt');
		expect(loaded?.entities).toHaveLength(2);
	});

	it('lists unfinished runs newest first, not finished ones', async () => {
		const idb = new IDBFactory();
		const a = await openUndoStore(idb);
		await a.saveRun(run('old', '2026-09-24T09:00:00Z'));
		await a.saveRun(run('new', '2026-09-24T11:00:00Z'));
		await a.saveRun(run('done', '2026-09-24T12:00:00Z'));
		await a.finishRun('done', '2026-09-24T12:05:00Z');

		const b = await openUndoStore(idb);
		expect((await b.unfinishedRuns()).map((r) => r.id)).toEqual(['new', 'old']);
		expect((await b.loadRun('done'))?.finishedAt).toBe('2026-09-24T12:05:00Z');
	});

	it('keeps the prepared batch of an entity through later state writes', async () => {
		const idb = new IDBFactory();
		const a = await openUndoStore(idb);
		await a.saveRun(run('r1', '2026-09-24T10:00:00Z'));
		const prepared = { before: snapshot(1), batch: [], appliedAt: '2026-09-24T10:00:01Z' };
		await a.saveEntity('r1', shot(1), { state: 'applying' }, prepared);
		await a.saveEntity('r1', shot(1), { state: 'applying' });

		const b = await openUndoStore(idb);
		expect(await b.prepared('r1', shot(1))).toEqual(prepared);
		expect(await b.prepared('r1', shot(2))).toBeNull();
	});

	it('deletes a run and its entities', async () => {
		const idb = new IDBFactory();
		const a = await openUndoStore(idb);
		await a.saveRun(run('r1', '2026-09-24T10:00:00Z'));
		await a.deleteRun('r1');
		const b = await openUndoStore(idb);
		expect(await b.loadRun('r1')).toBeNull();
		expect(await b.unfinishedRuns()).toEqual([]);
	});
});

describe('undo store without IndexedDB', () => {
	it('keeps everything in memory and says so', async () => {
		const s = await openUndoStore(undefined);
		expect(s.persistent).toBe(false);
		await s.saveRun(run('r1', '2026-09-24T10:00:00Z'));
		await s.saveEntity('r1', shot(2), { state: 'done', undo: record('r1', 2) });
		const loaded = await s.loadRun('r1');
		expect(loaded?.entities[1].status).toEqual({ state: 'done', undo: record('r1', 2) });
		expect((await s.unfinishedRuns()).map((r) => r.id)).toEqual(['r1']);
	});

	it('falls back to memory when the open is refused (private mode)', async () => {
		const refusing = {
			open() {
				throw new DOMException('The operation is insecure.', 'SecurityError');
			}
		} as unknown as IDBFactory;
		const s = await openUndoStore(refusing);
		expect(s.persistent).toBe(false);
		await s.saveRun(run('r1', '2026-09-24T10:00:00Z'));
		expect((await s.loadRun('r1'))?.id).toBe('r1');
	});

	it('drops to memory when a write fails mid-run, and keeps the record', async () => {
		const idb = new IDBFactory();
		const s = await openUndoStore(idb);
		await s.saveRun(run('r1', '2026-09-24T10:00:00Z'));
		// Close the database under the store: the next transaction throws.
		(s as unknown as { db: IDBDatabase }).db.close();
		await s.saveEntity('r1', shot(1), { state: 'done', undo: record('r1', 1) });
		expect(s.persistent).toBe(false);
		expect((await s.loadRun('r1'))?.entities[0].status).toEqual({ state: 'done', undo: record('r1', 1) });
	});
});

describe('undo file', () => {
	it('round-trips through a download and an upload', async () => {
		const records = [record('r1', 1), record('r1', 2)];
		expect(await readUndoFile(undoFileBlob(records))).toEqual(records);
	});

	it('refuses a file that is not an undo file', async () => {
		await expect(readUndoFile(new Blob(['{"version":2}']))).rejects.toThrow('This undo file is from another version (2).');
	});
});
