import { describe, expect, it } from 'vitest';
import { SgApiError, type BatchRequest } from 'sg-widgets-core';
import { matchKey } from '$lib/pure/matching';
import { remainingEntities } from '$lib/pure/run';
import type {
	EntityPlan,
	EntityRef,
	EntitySnapshot,
	EntityTask,
	ProjectContext,
	Run,
	RunOptions,
	TemplateTask
} from '$lib/pure/types';
import { applyRun, INTERRUPTED, recoverInterrupted, retryFailed, type ApplyProgress } from './apply';
import { openUndoStore } from './undo-store';

// Template 5 has one task, comp (template task 500). Shot n has one hand-made comp, Task n*10,
// which the plan claims.
const TEMPLATE = 5;
const shot = (id: number): EntityRef => ({ type: 'Shot', id });
const ctx: ProjectContext = { project: { type: 'Project', id: 1 }, defaultTaskStatus: 'wtg', validTaskStatuses: ['wtg', 'ip', 'omt'] };

const options = (o: Partial<RunOptions> = {}): RunOptions => ({
	fieldPolicies: {},
	extraByName: {},
	extraOverrides: {},
	omitStatus: 'omt',
	conflictPicks: {},
	edgeActions: {},
	clearCreatedDates: false,
	deleteConfirmed: false,
	...o
});

function core(id: number, content: string, start: string | null = null) {
	return {
		id,
		content,
		step: null,
		key: matchKey(content, null),
		status: 'wtg',
		sortOrder: null,
		duration: null,
		estInMins: null,
		description: null,
		milestone: false,
		startDate: start,
		dueDate: start,
		assignees: [],
		reviewers: [],
		fields: { content }
	};
}

const templateTask = (id: number, content: string): TemplateTask => ({ ...core(id, content), templateId: TEMPLATE });

function task(entity: number, id: number, content: string, link: number | null, start: string | null = null): EntityTask {
	return {
		...core(id, content, start),
		entity: shot(entity),
		templateTask: link === null ? null : { id: link, templateId: TEMPLATE },
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-01T00:00:00Z'
	};
}

function snap(id: number, tasks: EntityTask[], template: number | null = null): EntitySnapshot {
	return {
		entity: { ...shot(id), entityType: 'Shot', taskTemplate: template === null ? null : { type: 'TaskTemplate', id: template } },
		tasks,
		edges: [],
		usage: {},
		readAt: '2026-09-24T10:00:00Z'
	};
}

const edgePlan = () => ({ expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] });

/** Shot n: claim its comp (Task n*10) onto template task 500. */
function claimPlan(n: number): EntityPlan {
	return {
		entity: { ...shot(n), entityType: 'Shot', taskTemplate: null },
		templateId: TEMPLATE,
		rows: [{ kind: 'claim', task: task(n, n * 10, 'comp', null), templateTask: templateTask(500, 'comp'), previousTemplateTask: null, fieldChanges: [], rename: null }],
		edges: edgePlan(),
		counts: { keep: 0, claim: 1, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false
	};
}

/** Shot n: create the template's layout (template task 501); its dates are cleared after (097). */
function createPlan(n: number): EntityPlan {
	return {
		...claimPlan(n),
		rows: [{ kind: 'create', templateTask: templateTask(501, 'layout'), templateDates: { start: '2026-10-01', due: '2026-10-01' }, datesClearable: true }],
		counts: { keep: 0, claim: 0, create: 1, extra: 0, conflict: 0 }
	};
}

function newRun(n: number, o: Partial<RunOptions> = {}): Run {
	return {
		version: 1,
		id: 'run-1',
		project: ctx.project,
		template: { id: TEMPLATE, code: 'tt' },
		entryPoint: 'entities_first',
		user: { type: 'HumanUser', id: 9 },
		options: options(o),
		startedAt: '2026-09-24T10:00:00Z',
		finishedAt: null,
		entities: Array.from({ length: n }, (_, i) => ({ entity: shot(i + 1), status: { state: 'pending' as const } }))
	};
}

/**
 * A site the size of the test: each Shot reads its before-snapshot until a batch naming it lands,
 * then its after-snapshot. `fail` rejects the batches of chosen Shots with an SgApiError, as the
 * client does (status and the first error's title). Counts batches in flight.
 */
function fakeSite(opts: {
	before: (n: number) => EntitySnapshot;
	after: (n: number) => EntitySnapshot;
	fail?: Map<number, SgApiError>;
	latencyMs?: number;
}) {
	const landed = new Set<number>();
	const log: Array<{ shot: number; requests: BatchRequest[] }> = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const shotOf = (reqs: BatchRequest[]) => {
		const onShot = reqs.find((r) => r.entity === 'Shot');
		if (onShot && 'record_id' in onShot) return onShot.record_id;
		const onTask = reqs.find((r) => r.entity === 'Task' && 'record_id' in r) as { record_id: number } | undefined;
		return Math.floor((onTask?.record_id ?? 0) / 10);
	};
	const client = {
		async batch(requests: BatchRequest[]) {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			await new Promise((r) => setTimeout(r, opts.latencyMs ?? 5));
			inFlight--;
			const n = shotOf(requests);
			log.push({ shot: n, requests });
			const err = opts.fail?.get(n);
			if (err) throw err;
			landed.add(n);
			return [];
		}
	};
	const read = async (e: EntityRef) => (landed.has(e.id) ? opts.after(e.id) : opts.before(e.id));
	return { client, read, log, landed, maxInFlight: () => maxInFlight };
}

const claimedSite = (fail?: Map<number, SgApiError>) =>
	fakeSite({
		before: (n) => snap(n, [task(n, n * 10, 'comp', null)]),
		after: (n) => snap(n, [task(n, n * 10, 'comp', 500)], TEMPLATE),
		fail
	});

describe('applyRun', () => {
	it('keeps about four entities in flight and lands them all', async () => {
		const site = claimedSite();
		const store = await openUndoStore(undefined);
		const plans = Array.from({ length: 10 }, (_, i) => claimPlan(i + 1));
		const outcomes = await applyRun(newRun(10), plans, ctx, { client: site.client, read: site.read, store });

		expect(site.maxInFlight()).toBe(4);
		expect(outcomes.map((o) => o.result.kind)).toEqual(Array(10).fill('ok'));
		expect(outcomes.map((o) => o.entity.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const stored = await store.loadRun('run-1');
		expect(stored?.finishedAt).not.toBeNull();
		expect(stored?.entities.every((e) => e.status.state === 'done')).toBe(true);
	});

	it('cancel after current: finishes what is in flight, starts nothing more, leaves the rest pending', async () => {
		const site = claimedSite();
		const store = await openUndoStore(undefined);
		const plans = Array.from({ length: 10 }, (_, i) => claimPlan(i + 1));
		let stop = false;
		const onProgress = (p: ApplyProgress) => {
			if (p.state === 'done' && p.entity.id === 1) stop = true;
		};
		const outcomes = await applyRun(newRun(10), plans, ctx, { client: site.client, read: site.read, store, shouldStop: () => stop, onProgress });

		// Four were in flight when the first landed: they finish, nothing else starts.
		expect(outcomes.map((o) => o.entity.id)).toEqual([1, 2, 3, 4]);
		const stored = (await store.loadRun('run-1'))!;
		expect(stored.entities.map((e) => e.status.state)).toEqual([...Array(4).fill('done'), ...Array(6).fill('pending')]);
		expect(stored.finishedAt).not.toBeNull();
	});

	it('reports a failed entity with its error title on progress', async () => {
		const site = claimedSite(new Map([[1, new SgApiError(400, null, 'The field is not editable for this user')]]));
		const store = await openUndoStore(undefined);
		const seen: ApplyProgress[] = [];
		await applyRun(newRun(1), [claimPlan(1)], ctx, { client: site.client, read: site.read, store, onProgress: (p) => seen.push(p) });
		expect(seen.at(-1)).toEqual({ entity: shot(1), state: 'failed', finished: 1, total: 1, error: { status: 400, message: 'The field is not editable for this user' } });
	});

	it('sends the one batch per entity, claim then template (recipe 020)', async () => {
		const site = claimedSite();
		const store = await openUndoStore(undefined);
		await applyRun(newRun(1), [claimPlan(1)], ctx, { client: site.client, read: site.read, store });
		expect(site.log).toEqual([
			{
				shot: 1,
				requests: [
					{ request_type: 'update', entity: 'Task', record_id: 10, data: { template_task: { type: 'Task', id: 500 } } },
					{ request_type: 'update', entity: 'Shot', record_id: 1, data: { task_template: { type: 'TaskTemplate', id: TEMPLATE } } }
				]
			}
		]);
	});

	it('stores each undo record as its entity lands, before the run ends', async () => {
		const site = claimedSite();
		const store = await openUndoStore(undefined);
		const seen: string[] = [];
		const onProgress = async (p: ApplyProgress) => {
			if (p.state !== 'done') return;
			const run = await store.loadRun('run-1');
			const s = run?.entities.find((e) => e.entity.id === p.entity.id)?.status;
			seen.push(`${p.entity.id}:${s?.state}:${s?.state === 'done' ? s.undo.claimed[0].taskId : ''}`);
		};
		await applyRun(newRun(2), [claimPlan(1), claimPlan(2)], ctx, { client: site.client, read: site.read, store, concurrency: 1, onProgress });
		expect(seen).toEqual(['1:done:10', '2:done:20']);
	});

	it('stops a failed entity only, with the error title verbatim, and the run goes on', async () => {
		const title = 'Entity of type [Task] with id=30 does not exist.';
		const site = claimedSite(new Map([[3, new SgApiError(404, null, title)]]));
		const store = await openUndoStore(undefined);
		const plans = Array.from({ length: 5 }, (_, i) => claimPlan(i + 1));
		const outcomes = await applyRun(newRun(5), plans, ctx, { client: site.client, read: site.read, store });

		expect(outcomes.map((o) => o.result.kind)).toEqual(['ok', 'ok', 'failed', 'ok', 'ok']);
		expect(outcomes[2].result).toEqual({ kind: 'failed', entity: shot(3), error: { status: 404, message: title } });
		expect(outcomes[2].undo).toBeNull();
		const stored = (await store.loadRun('run-1'))!;
		expect(remainingEntities(stored)).toEqual([shot(3)]);
	});

	it('retries a failed entity once the cause is gone', async () => {
		const fail = new Map([[2, new SgApiError(500, null, 'Internal Server Error')]]);
		const site = claimedSite(fail);
		const store = await openUndoStore(undefined);
		const run = newRun(2);
		const plans = [claimPlan(1), claimPlan(2)];
		const deps = { client: site.client, read: site.read, store };
		const first = await applyRun(run, plans, ctx, deps);
		fail.clear();
		const again = await retryFailed(run, [{ plan: plans[1], outcome: first[1] }], ctx, deps);
		expect(again[0].result.kind).toBe('ok');
		expect((await store.loadRun('run-1'))!.entities[1].status.state).toBe('done');
	});

	it('fails an entity whose batch cannot be built, without sending anything', async () => {
		const site = claimedSite();
		const store = await openUndoStore(undefined);
		const plan = claimPlan(1);
		plan.rows.push({ kind: 'extra', task: task(1, 11, 'paint', null), action: 'omit', usage: { versions: 0, publishedFiles: 0 }, reason: 'not_in_template' });
		const outcomes = await applyRun(newRun(1, { omitStatus: 'gone' }), [plan], ctx, { client: site.client, read: site.read, store });
		expect(outcomes[0].stage).toBe('validate');
		expect(outcomes[0].result).toMatchObject({ kind: 'failed', error: { message: 'omit status "gone" is not a valid Task status in this project' } });
		expect(site.log).toEqual([]);
	});

	it('runs the after-apply phase from the read-back and records the cleared dates (097)', async () => {
		const site = fakeSite({
			before: (n) => snap(n, []),
			after: (n) => snap(n, [task(n, n * 10 + 1, 'layout', 501, site.log.length > 1 ? null : '2026-10-01')], TEMPLATE)
		});
		const store = await openUndoStore(undefined);
		const outcomes = await applyRun(newRun(1, { clearCreatedDates: true }), [createPlan(1)], ctx, { client: site.client, read: site.read, store });

		expect(site.log.map((l) => l.requests)).toEqual([
			[{ request_type: 'update', entity: 'Shot', record_id: 1, data: { task_template: { type: 'TaskTemplate', id: TEMPLATE } } }],
			[{ request_type: 'update', entity: 'Task', record_id: 11, data: { start_date: null, due_date: null } }]
		]);
		expect(outcomes[0].undo?.created).toEqual([11]);
		expect(outcomes[0].undo?.clearedDates).toEqual([{ taskId: 11, start: '2026-10-01', due: '2026-10-01' }]);
		expect(outcomes[0].result).toMatchObject({ kind: 'ok', created: [11], differences: [] });
	});

	it('keeps the landed record when the after-apply phase fails, and retries that phase alone', async () => {
		let failPhase2 = true;
		const site = fakeSite({
			before: (n) => snap(n, []),
			after: (n) => snap(n, [task(n, n * 10 + 1, 'layout', 501, site.log.length > 1 && !failPhase2 ? null : '2026-10-01')], TEMPLATE)
		});
		const client = {
			async batch(reqs: BatchRequest[]) {
				if (reqs[0].entity === 'Task' && failPhase2) throw new SgApiError(400, null, 'API update() Task.start_date is locked.');
				return site.client.batch(reqs);
			}
		};
		const store = await openUndoStore(undefined);
		const run = newRun(1, { clearCreatedDates: true });
		const deps = { client, read: site.read, store };
		const [first] = await applyRun(run, [createPlan(1)], ctx, deps);
		expect(first.stage).toBe('after_apply');
		expect(first.undo?.created).toEqual([11]);
		expect((await store.loadRun('run-1'))!.entities[0].status).toMatchObject({ state: 'failed', undo: { created: [11] } });

		failPhase2 = false;
		const [again] = await retryFailed(run, [{ plan: createPlan(1), outcome: first }], ctx, deps);
		expect(again.result.kind).toBe('ok');
		expect(site.log.filter((l) => l.requests[0].entity === 'Shot')).toHaveLength(1); // phase 1 not resent
	});
});

describe('recoverInterrupted', () => {
	it('rebuilds the record of an entity left applying with its batch prepared', async () => {
		const site = claimedSite();
		const store = await openUndoStore(undefined);
		const run = newRun(2);
		await store.saveRun(run);
		const batch: BatchRequest[] = [
			{ request_type: 'update', entity: 'Task', record_id: 10, data: { template_task: { type: 'Task', id: 500 } } },
			{ request_type: 'update', entity: 'Shot', record_id: 1, data: { task_template: { type: 'TaskTemplate', id: TEMPLATE } } }
		];
		await store.saveEntity(run.id, shot(1), { state: 'applying' }, { before: snap(1, [task(1, 10, 'comp', null)]), batch, appliedAt: '2026-09-24T10:00:01Z' });
		await store.saveEntity(run.id, shot(2), { state: 'applying' });
		site.landed.add(1); // the batch landed, the tab closed

		const recovered = await recoverInterrupted(run, site.read, store);
		const s1 = recovered.entities[0].status;
		expect(s1).toMatchObject({ state: 'failed', error: { message: INTERRUPTED }, undo: { claimed: [{ taskId: 10, previousTemplateTask: null }] } });
		expect(remainingEntities(recovered)).toEqual([shot(2)]);
	});
});
