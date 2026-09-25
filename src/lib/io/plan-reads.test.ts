import { describe, expect, it } from 'vitest';
import { readForPlan, type PlanReadDeps } from './plan-reads';
import { matchKey } from '$lib/pure/matching';
import type { AccessSummary, EntityRef, EntitySnapshot, EntityTask, ProjectContext, Template } from '$lib/pure/types';

const STEP = { type: 'Step', id: 11, name: 'Comp' };

const comp = (id: number): EntityTask => ({
	id,
	content: 'Comp',
	step: STEP,
	key: matchKey('Comp', 11),
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
	fields: { content: 'Comp', step: 11 },
	entity: { type: 'Shot', id: 1, name: 'sh1' },
	templateTask: null,
	pinned: false,
	dependencyViolation: false,
	createdAt: '2026-09-01T00:00:00Z'
});

const { entity: _e, templateTask: _t, pinned: _p, dependencyViolation: _d, createdAt: _c, ...core } = comp(100);
const template: Template = { id: 5, code: 'T', entityType: 'Shot', tasks: [{ ...core, templateId: 5 }], edges: [] };

const ctx: ProjectContext = { project: { type: 'Project', id: 1180 }, validTaskStatuses: ['wtg', 'ip', 'omt'], defaultTaskStatus: 'wtg' };
const summary: AccessSummary = { checks: [], fields: {}, looksShort: false };

const snap = (e: EntityRef, tasks: EntityTask[] = []): EntitySnapshot => ({
	entity: { type: e.type, id: e.id, name: e.name, entityType: e.type, taskTemplate: null },
	tasks,
	edges: [],
	usage: {},
	readAt: '2026-09-24T00:00:00Z'
});
const bare = (e: EntityRef) => snap(e);

const shots = (n: number): EntityRef[] => Array.from({ length: n }, (_, i) => ({ type: 'Shot', id: i + 1, name: `sh${i + 1}` }));

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

describe('readForPlan', () => {
	it('starts the access check once a batch holds a Task the run writes, before the other batches are in', async () => {
		const gates = [deferred<void>(), deferred<void>()];
		const events: string[] = [];
		const deps: PlanReadDeps = {
			context: async () => ctx,
			snapshots: async (batch) => {
				const i = batch[0].id === 1 ? 0 : 1;
				if (i === 1) await gates[1].promise;
				events.push(`batch ${i}`);
				return i === 0 ? [snap(batch[0], [comp(7)]), bare(batch[1])] : batch.map(bare);
			},
			access: async () => {
				events.push('access');
				gates[1].resolve();
				return summary;
			}
		};
		const progress: number[] = [];
		const out = await readForPlan(deps, { template, selected: shots(4), batchSize: 2, concurrency: 4, onProgress: (d) => progress.push(d) });
		expect(events.slice(0, 2)).toEqual(['batch 0', 'access']);
		expect(out.snapshots).toHaveLength(4);
		expect(progress).toEqual([2, 4]);
		expect(await out.access).toBe(summary);
	});

	it('samples after every read when no batch holds a Task the run writes, and answers null with no Task at all', async () => {
		let accessCalls = 0;
		const deps: PlanReadDeps = {
			context: async () => ctx,
			snapshots: async (batch) => batch.map(bare),
			access: async () => {
				accessCalls++;
				return summary;
			}
		};
		const out = await readForPlan(deps, { template, selected: shots(3), batchSize: 2, concurrency: 4, onProgress: () => {} });
		expect(await out.access).toBeNull();
		expect(accessCalls).toBe(0);
		expect(out.ctx).toBe(ctx);
	});

	it('falls back to any Task once every batch is in, when none is one the run writes', async () => {
		const other = { ...comp(8), content: 'Roto', key: matchKey('Roto', 11) };
		const sampled: number[] = [];
		const deps: PlanReadDeps = {
			context: async () => ctx,
			snapshots: async (batch) => batch.map((e) => (e.id === 3 ? snap(e, [other]) : bare(e))),
			access: async (sample) => {
				sampled.push(sample.task.id);
				return summary;
			}
		};
		const out = await readForPlan(deps, { template, selected: shots(4), batchSize: 2, concurrency: 4, onProgress: () => {} });
		expect(await out.access).toBe(summary);
		expect(sampled).toEqual([8]);
	});

	it('keeps at most `concurrency` snapshot reads in flight', async () => {
		let inFlight = 0;
		let peak = 0;
		const deps: PlanReadDeps = {
			context: async () => ctx,
			snapshots: async (batch) => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await new Promise((r) => setTimeout(r, 5));
				inFlight--;
				return batch.map(bare);
			},
			access: async () => summary
		};
		await readForPlan(deps, { template, selected: shots(20), batchSize: 2, concurrency: 4, onProgress: () => {} });
		expect(peak).toBe(4);
	});
});
