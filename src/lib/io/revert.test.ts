import { describe, expect, it } from 'vitest';
import { SgApiError, type BatchRequest } from 'sg-widgets-core';
import { MockClient } from 'sg-widgets-core/mock';
import type { Edge, EntityRef, EntitySnapshot, Id, Run, UndoRecord } from '$lib/pure/types';
import { revertEntity, revertRecords } from './revert';
import { openUndoStore } from './undo-store';

const TEMPLATE = 5;

function record(entity: EntityRef, o: Partial<UndoRecord> = {}): UndoRecord {
	return {
		version: 1,
		runId: 'run-1',
		entity,
		templateId: TEMPLATE,
		appliedAt: '2026-09-24T10:00:00Z',
		// Already on this template before: the revert writes no task_template (undo.ts).
		previousTaskTemplate: { type: 'TaskTemplate', id: TEMPLATE },
		claimed: [],
		created: [],
		fieldValues: [],
		omitted: [],
		deletedTasks: [],
		droppedEdges: [],
		recreatedEdges: [],
		deletedEdges: [],
		addedEdges: [],
		clearedDates: [],
		...o
	};
}

const snap = (entity: EntityRef, edges: Edge[] = []): EntitySnapshot => ({
	entity: { ...entity, entityType: entity.type, taskTemplate: null },
	tasks: [],
	edges,
	usage: {},
	readAt: '2026-09-24T10:00:00Z'
});

const edge = (id: Id, downstream: Id, upstream: Id): Edge & { id: Id } => ({
	id,
	downstream,
	upstream,
	type: 'finish-to-start-next-day',
	offsetDays: null
});

/** Wrap a client so every call lands in `log`, in order. */
function spy(client: { batch(r: BatchRequest[]): Promise<unknown>; revive(t: string, id: number): Promise<boolean> }) {
	const log: string[] = [];
	return {
		log,
		client: {
			async batch(requests: BatchRequest[]) {
				log.push(`batch ${requests.map((r) => `${r.request_type} ${r.entity} ${'record_id' in r ? r.record_id : ''}`.trim()).join(', ')}`);
				return client.batch(requests) as never;
			},
			async revive(type: string, id: number) {
				log.push(`revive ${type} ${id}`);
				return client.revive(type, id);
			}
		}
	};
}

describe('revertEntity', () => {
	it('revives deleted Tasks before the batch (103, 110), against the mock site', async () => {
		const mock = new MockClient();
		const [deleted, omitted] = mock.rowsOf('Task') as Array<{ id: number }>;
		const shotId = (mock.rowsOf('Shot')[0] as { id: number }).id;
		const entity = { type: 'Shot', id: shotId };
		await mock.delete('Task', deleted.id); // the apply's delete of an extra
		const s = spy(mock);
		const read = async (e: EntityRef) => {
			s.log.push('read');
			return snap(e);
		};

		const out = await revertEntity(
			record(entity, { deletedTasks: [deleted.id], omitted: [{ taskId: omitted.id, previousStatus: 'ip' }] }),
			{ client: s.client, read }
		);

		expect(out.kind).toBe('ok');
		expect(s.log).toEqual([`revive Task ${deleted.id}`, 'read', `batch update Task ${omitted.id}`, 'read']);
		const rows = mock.rowsOf('Task') as Array<{ id: number; sg_status_list: string }>;
		expect(rows.some((r) => r.id === deleted.id)).toBe(true);
		expect(rows.find((r) => r.id === omitted.id)?.sg_status_list).toBe('ip');
	});

	it('reverts edges from a fresh read: remove, then revive (095), then create', async () => {
		const s = spy({ batch: async () => [], revive: async () => true });
		// Before: e1 (a DELETE the apply sent, revivable) and e2 (erased by the apply, 101).
		// Live now: e3 sits on e1's pair.
		const e1 = edge(1, 10, 11);
		const e2 = edge(2, 12, 11);
		const e3 = edge(3, 11, 10);
		const rec = record({ type: 'Shot', id: 1 }, { deletedEdges: [e1], droppedEdges: [e2], edgesBefore: [e1, e2] });
		const out = await revertEntity(rec, { client: s.client, read: async (e) => snap(e, [e3]) });

		expect(out.kind).toBe('ok');
		expect(s.log).toEqual(['batch delete TaskDependency 3', 'revive TaskDependency 1', 'batch create TaskDependency']);
	});

	it('stops at the failing call with the error title verbatim', async () => {
		const title = 'Entity of type [TaskDependency] with id=4409 does not exist.';
		const client = {
			batch: async () => {
				throw new SgApiError(404, null, title);
			},
			revive: async () => true
		};
		const rec = record({ type: 'Shot', id: 1 }, { omitted: [{ taskId: 10, previousStatus: 'ip' }] });
		const out = await revertEntity(rec, { client, read: async (e) => snap(e) });
		expect(out).toEqual({ kind: 'failed', entity: { type: 'Shot', id: 1 }, stage: 'batch', error: { status: 404, message: title } });
	});
});

describe('revertRecords', () => {
	it('reverts every entity it can and marks those undone in the run', async () => {
		const store = await openUndoStore(undefined);
		const shot = (id: number) => ({ type: 'Shot', id });
		const recs = [1, 2, 3].map((n) => record(shot(n), { omitted: [{ taskId: n * 10, previousStatus: 'ip' }] }));
		const run: Run = {
			version: 1,
			id: 'run-1',
			project: { type: 'Project', id: 1 },
			template: { id: TEMPLATE, code: 'tt' },
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
				deleteConfirmed: false
			},
			startedAt: '2026-09-24T10:00:00Z',
			finishedAt: '2026-09-24T10:01:00Z',
			entities: recs.map((undo) => ({ entity: undo.entity, status: { state: 'done' as const, undo } }))
		};
		await store.saveRun(run);
		const client = {
			batch: async (reqs: BatchRequest[]) => {
				if ('record_id' in reqs[0] && reqs[0].record_id === 20) throw new SgApiError(403, null, 'Forbidden');
				return [];
			},
			revive: async () => true
		};
		const out = await revertRecords(recs, { client, read: async (e) => snap(e), store });
		expect(out.map((o) => o.kind)).toEqual(['ok', 'failed', 'ok']);
		const states = (await store.loadRun('run-1'))!.entities.map((e) => e.status.state);
		expect(states).toEqual(['undone', 'done', 'undone']);
	});
});
