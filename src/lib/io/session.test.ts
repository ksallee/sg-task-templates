/**
 * The screens' flows end to end against the scripted fake client: apply with live lines, a failure
 * and its retry, the result rows, undo per entity and per run, the undo file round trip, and the
 * resume of an interrupted run.
 */
import { describe, expect, it } from 'vitest';
import { SgApiError, type BatchRequest } from 'sg-widgets-core';
import { applyEvent, initialLines, newRun } from '$lib/pure/apply-view';
import { matchKey } from '$lib/pure/matching';
import { nameBook, resultRows } from '$lib/pure/result-view';
import { undoRecordsOf } from '$lib/pure/run';
import { serializeUndo } from '$lib/pure/undo';
import type { EntityPlan, EntityRef, EntitySnapshot, EntityTask, ProjectContext, RunOptions } from '$lib/pure/types';
import { applyRun, INTERRUPTED, retryFailed, type ApplyDeps } from './apply';
import { fakeClient } from './fake-client';
import { openStoredRun, snapshotReader, undoRecords } from './session';
import { openUndoStore, readUndoFile, undoFileBlob } from './undo-store';

const TEMPLATE = 5;
const shot = (id: number): EntityRef => ({ type: 'Shot', id, name: `sh${id}` });
const ctx: ProjectContext = { project: { type: 'Project', id: 1 }, defaultTaskStatus: 'wtg', validTaskStatuses: ['wtg', 'omt'] };
const options: RunOptions = {
	fieldPolicies: {},
	extraByName: {},
	extraOverrides: {},
	omitStatus: 'omt',
	conflictPicks: {},
	edgeActions: {},
	clearCreatedDates: false,
};

function task(entity: number, link: number | null): EntityTask {
	return {
		id: entity * 10,
		content: 'comp',
		step: null,
		key: matchKey('comp', null),
		status: 'wtg',
		sortOrder: null,
		duration: null,
		estInMins: null,
		description: null,
		milestone: false,
		startDate: null,
		dueDate: null,
		assignees: [],
		reviewers: [],
		fields: { content: 'comp' },
		entity: shot(entity),
		templateTask: link === null ? null : { id: link, templateId: link === 500 ? TEMPLATE : 4 },
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-01T00:00:00Z'
	};
}

const snap = (n: number, link: number | null, template: number | null): EntitySnapshot => ({
	entity: { ...shot(n), entityType: 'Shot', taskTemplate: template === null ? null : { type: 'TaskTemplate', id: template } },
	tasks: [task(n, link)],
	edges: [],
	usage: {},
	readAt: '2026-09-24T10:00:00Z'
});

/** Shot n: claim its comp (Task n*10, on old template 4's task 400) onto template task 500. */
function claimPlan(n: number): EntityPlan {
	const { entity: _e, templateTask: _t, pinned: _p, dependencyViolation: _d, createdAt: _c, ...core } = task(n, null);
	return {
		entity: { ...shot(n), entityType: 'Shot', taskTemplate: { type: 'TaskTemplate', id: 4 } },
		templateId: TEMPLATE,
		rows: [{ kind: 'claim', task: task(n, 400), templateTask: { ...core, id: 500, templateId: TEMPLATE }, previousTemplateTask: null, fieldChanges: [], rename: null }],
		edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
		counts: { keep: 0, claim: 1, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false
	};
}

/**
 * The site behind the fake client: each Shot is on template 4 until a batch writes template 5
 * onto it, and back once a batch writes 4. `refuse` rejects a Shot's batches as the client does.
 */
function site(refuse = new Map<number, SgApiError>()) {
	const on = new Map<number, number>();
	const batches: BatchRequest[][] = [];
	const { client, calls } = fakeClient({
		batch: async (requests) => {
			const reqs = requests as BatchRequest[];
			const write = reqs.find((r) => r.entity === 'Shot' && r.request_type === 'update');
			const n = write && 'record_id' in write ? write.record_id : 0;
			const err = refuse.get(n);
			if (err) throw err;
			batches.push(reqs);
			const t = write && write.request_type === 'update' ? (write.data.task_template as { id: number } | null) : null;
			if (t) on.set(n, t.id);
			return [];
		},
		revive: async () => true
	});
	const read = async (e: EntityRef) => {
		const t = on.get(e.id) ?? 4;
		return snap(e.id, t === TEMPLATE ? 500 : 400, t);
	};
	return { client, calls, read, batches, on };
}

const run3 = () =>
	newRun({
		id: 'run-1',
		project: ctx.project,
		template: { id: TEMPLATE, code: 'TT Seed · Shot v2' },
		user: { type: 'HumanUser', id: 9 },
		options,
		plans: [1, 2, 3].map(claimPlan),
		now: '2026-09-24T10:00:00Z'
	});

describe('apply, result, retry, undo', () => {
	it('runs the whole flow through the fake client', async () => {
		const refuse = new Map([[2, new SgApiError(400, null, 'The field is not editable for this user')]]);
		const s = site(refuse);
		const store = await openUndoStore(undefined);
		const plans = [1, 2, 3].map(claimPlan);
		const run = run3();
		let lines = initialLines(plans);
		const deps: ApplyDeps = { client: s.client, read: s.read, store, onProgress: (p) => (lines = applyEvent(lines, p)) };

		const outcomes = await applyRun(run, plans, ctx, deps);
		expect(lines.map((l) => [l.label, l.state, l.error])).toEqual([
			['sh1', 'landed', null],
			['sh2', 'failed', 'Flow PT refused the write. Nothing was written.'],
			['sh3', 'landed', null]
		]);

		let stored = (await store.loadRun('run-1'))!;
		const names = nameBook(plans);
		expect(resultRows(stored, outcomes, names, new Set(['Shot:2'])).map((r) => [r.label, r.kind, r.retry, r.canUndo])).toEqual([
			['sh1', 'clean', null, true],
			['sh2', 'failed', 'replan', false],
			['sh3', 'clean', null, true]
		]);

		refuse.clear();
		const again = await retryFailed(run, [{ plan: plans[1], stage: outcomes[1].stage }], ctx, deps);
		expect(again[0].result.kind).toBe('ok');
		expect(lines[1].state).toBe('landed');

		// Undo one entity: its old template back, its claim unwound.
		stored = (await store.loadRun('run-1'))!;
		const [first, ...rest] = undoRecordsOf(stored);
		const one = await undoRecords([first], { client: s.client, read: s.read, store });
		expect(one.map((o) => o.kind)).toEqual(['ok']);
		expect(s.on.get(1)).toBe(4);
		expect(s.batches.at(-1)).toEqual([
			{ request_type: 'update', entity: 'Task', record_id: 10, data: { template_task: { type: 'Task', id: 400 } } },
			{ request_type: 'update', entity: 'Shot', record_id: 1, data: { task_template: { type: 'TaskTemplate', id: 4 } } },
			{ request_type: 'update', entity: 'Task', record_id: 10, data: { content: 'comp', task_assignees: [] } } // 112: content written back; 102: the old template fills empty assignees
		]);
		expect((await store.loadRun('run-1'))!.entities[0].status.state).toBe('undone');

		// Undo the rest: the run is left with nothing to undo.
		await undoRecords(rest, { client: s.client, read: s.read, store });
		stored = (await store.loadRun('run-1'))!;
		expect(stored.entities.map((e) => e.status.state)).toEqual(['undone', 'undone', 'undone']);
		expect(undoRecordsOf(stored)).toEqual([]);
	});

	it('undoes a run from a downloaded file in a session that never saw it', async () => {
		const s = site();
		const plans = [1, 2, 3].map(claimPlan);
		const first = await openUndoStore(undefined);
		await applyRun(run3(), plans, ctx, { client: s.client, read: s.read, store: first });
		const blob = undoFileBlob(undoRecordsOf((await first.loadRun('run-1'))!));

		const other = await openUndoStore(undefined);
		const records = await readUndoFile(blob);
		expect(records.map((r) => r.entity.id)).toEqual([1, 2, 3]);
		const out = await undoRecords(records, { client: s.client, read: s.read, store: other });
		expect(out.map((o) => o.kind)).toEqual(['ok', 'ok', 'ok']);
		expect([...s.on.values()]).toEqual([4, 4, 4]);
	});

	it('refuses a file that is not an undo file, with undo.ts\'s message', async () => {
		await expect(readUndoFile(new Blob([serializeUndo([]).replace('"version": 1', '"version": 2')]))).rejects.toThrow('This undo file is from another version (2).');
	});

	it('closes a stored run once everything that landed is undone and nothing is left to apply', async () => {
		const s = site();
		const store = await openUndoStore(undefined);
		await store.saveRun(run3());
		// Only Shot 1 landed; 2 and 3 never started. Undo leaves the run open: it still owes two.
		const outcomes = await applyRun(run3(), [claimPlan(1)], ctx, { client: s.client, read: s.read, store });
		await undoRecords([outcomes[0].undo!], { client: s.client, read: s.read, store, now: () => 'now' });
		expect((await store.loadRun('run-1'))!.finishedAt).not.toBe('now');
	});
});

describe('resume', () => {
	it('rebuilds the record of an entity left applying, and lists what never landed', async () => {
		const s = site();
		const store = await openUndoStore(undefined);
		await store.saveRun(run3());
		// The tab closed mid-batch on Shot 1: the batch landed, nothing was read back.
		const before = await s.read(shot(1));
		const batch: BatchRequest[] = [
			{ request_type: 'update', entity: 'Task', record_id: 10, data: { template_task: { type: 'Task', id: 500 } } },
			{ request_type: 'update', entity: 'Shot', record_id: 1, data: { task_template: { type: 'TaskTemplate', id: TEMPLATE } } }
		];
		await store.saveEntity('run-1', shot(1), { state: 'applying' }, { before, batch, appliedAt: '2026-09-24T10:00:01Z' });
		await s.client.batch(batch);

		expect((await store.unfinishedRuns()).map((r) => r.id)).toEqual(['run-1']);
		const opened = (await openStoredRun(store, 'run-1', s.read))!;
		const first = opened.run.entities[0].status;
		expect(first.state).toBe('failed');
		expect(first.state === 'failed' && first.error.message).toBe(INTERRUPTED);
		expect(first.state === 'failed' && first.undo?.claimed).toEqual([{ taskId: 10, previousTemplateTask: 400 }]);
		expect(opened.remaining).toEqual([shot(2), shot(3)]);
		expect(await openStoredRun(store, 'nope', s.read)).toBeNull();
	});

	it('a dead run: an entity that never sent its batch, or whose batch never landed, is pending again (QA item 5)', async () => {
		const s = site();
		const store = await openUndoStore(undefined);
		await store.saveRun(run3());
		const batch: BatchRequest[] = [{ request_type: 'update', entity: 'Shot', record_id: 1, data: { task_template: { type: 'TaskTemplate', id: TEMPLATE } } }];
		await store.saveEntity('run-1', shot(1), { state: 'applying' }, { before: await s.read(shot(1)), batch, appliedAt: 'x' });
		await store.saveEntity('run-1', shot(2), { state: 'applying' });
		const opened = (await openStoredRun(store, 'run-1', s.read))!;
		expect(opened.run.entities.map((e) => e.status.state)).toEqual(['pending', 'pending', 'pending']);
		expect(opened.remaining).toEqual([shot(1), shot(2), shot(3)]);
		expect(opened.live).toBe(false);
	});

	it('a run another tab is applying is left as it is', async () => {
		const s = site();
		const store = await openUndoStore(undefined);
		await store.saveRun(run3());
		await store.saveEntity('run-1', shot(1), { state: 'applying' });
		const opened = (await openStoredRun(store, 'run-1', s.read, async () => true))!;
		expect(opened.live).toBe(true);
		expect(opened.run.entities[0].status.state).toBe('applying');
		expect(opened.remaining).toEqual([]);
	});
});

describe('snapshotReader', () => {
	it('reads one entity through load.ts, and says so when it is gone', async () => {
		const { client, calls } = fakeClient({}, {});
		await expect(snapshotReader(client, null)(shot(7))).rejects.toThrow('Shot 7 was not found: it may have been deleted.');
		expect(calls[0].method).toBe('search');
		expect(calls[0].args[0]).toBe('Shot');
	});
});
