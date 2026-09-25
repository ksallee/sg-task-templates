import { describe, expect, it } from 'vitest';
import { SgApiError } from 'sg-widgets-core';
import type { BatchRequest, EntityRef, EntityTask, Run, UndoRecord } from './types';
import { clearedDatesFrom, entityKey, errorOf, remainingEntities, singleFlight, undoRecordsOf, withEntityState } from './run';

const shot = (id: number): EntityRef => ({ type: 'Shot', id });

function record(id: number): UndoRecord {
	return {
		version: 1,
		runId: 'r1',
		entity: shot(id),
		templateId: 5,
		appliedAt: '2026-09-24T10:00:00Z',
		previousTaskTemplate: null,
		claimed: [],
		created: [],
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

function run(): Run {
	return {
		version: 1,
		id: 'r1',
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
		startedAt: '2026-09-24T10:00:00Z',
		finishedAt: null,
		entities: [
			{ entity: shot(1), status: { state: 'done', undo: record(1) } },
			{ entity: shot(2), status: { state: 'failed', error: { status: 400, message: 'x' }, undo: null } },
			{ entity: shot(3), status: { state: 'failed', error: { status: 400, message: 'y' }, undo: record(3) } },
			{ entity: shot(4), status: { state: 'pending' } },
			{ entity: shot(5), status: { state: 'applying' } },
			{ entity: shot(6), status: { state: 'undone', undo: record(6) } }
		]
	};
}

describe('entityKey', () => {
	it('is type and id', () => {
		expect(entityKey({ type: 'Shot', id: 7, name: 'sh010' })).toBe('Shot:7');
	});
});

describe('remainingEntities', () => {
	it('is every entity nothing landed on: pending, applying, failed without a record', () => {
		expect(remainingEntities(run()).map((e) => e.id)).toEqual([2, 4, 5]);
	});
});

describe('undoRecordsOf', () => {
	it('takes the records of landed entities not yet undone', () => {
		expect(undoRecordsOf(run()).map((r) => r.entity.id)).toEqual([1, 3]);
	});
});

describe('withEntityState', () => {
	it('replaces one entity state and leaves the run untouched', () => {
		const r = run();
		const next = withEntityState(r, shot(4), { state: 'applying' });
		expect(next.entities[3].status).toEqual({ state: 'applying' });
		expect(r.entities[3].status).toEqual({ state: 'pending' });
	});

	it('appends an entity the run did not list', () => {
		const next = withEntityState(run(), shot(99), { state: 'pending' });
		expect(next.entities.at(-1)).toEqual({ entity: shot(99), status: { state: 'pending' } });
	});
});

describe('errorOf', () => {
	it('keeps the client error title verbatim with its status', () => {
		const e = new SgApiError(404, null, 'Entity of type [TaskDependency] with id=4409 does not exist.');
		expect(errorOf(e)).toEqual({ status: 404, message: 'Entity of type [TaskDependency] with id=4409 does not exist.' });
	});

	it('has no status for anything else', () => {
		expect(errorOf(new TypeError('Failed to fetch'))).toEqual({ status: null, message: 'Failed to fetch' });
		expect(errorOf('boom')).toEqual({ status: null, message: 'boom' });
	});
});

describe('clearedDatesFrom', () => {
	const t = (id: number, start: string | null, due: string | null) =>
		({ id, startDate: start, dueDate: due }) as EntityTask;

	it('records the dates each date-clearing request removes, from the read before it', () => {
		const reqs: BatchRequest[] = [
			{ request_type: 'update', entity: 'Task', record_id: 11, data: { start_date: null, due_date: null } },
			{ request_type: 'delete', entity: 'TaskDependency', record_id: 3 },
			{ request_type: 'update', entity: 'Task', record_id: 12, data: { template_task: null } }
		];
		expect(clearedDatesFrom(reqs, [t(11, '2026-10-01', '2026-10-03'), t(12, '2026-10-01', null)])).toEqual([
			{ taskId: 11, start: '2026-10-01', due: '2026-10-03' }
		]);
	});
});

describe('singleFlight', () => {
	it('answers a second call while the first runs with the first call\'s promise, and runs again once it settles', async () => {
		let runs = 0;
		let release!: () => void;
		const once = singleFlight(async () => {
			runs++;
			await new Promise<void>((r) => (release = r));
			return runs;
		});
		const a = once();
		const b = once();
		expect(b).toBe(a);
		release();
		expect(await a).toBe(1);
		const c = once();
		expect(c).not.toBe(a);
		release();
		expect(await c).toBe(2);
		expect(runs).toBe(2);
	});

	it('runs again after a failure', async () => {
		let runs = 0;
		const once = singleFlight(async () => {
			runs++;
			if (runs === 1) throw new Error('boom');
			return runs;
		});
		await expect(once()).rejects.toThrow('boom');
		expect(await once()).toBe(2);
	});
});
