import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import { describeChanges, snapshotChanges } from './drift';
import type { Edge, EntitySnapshot, EntityTask } from './types';

function task(id: number, content: string, o: Partial<EntityTask> = {}): EntityTask {
	return {
		id,
		content,
		step: { type: 'Step', id: 7, name: 'Comp' },
		key: matchKey(content, 7),
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
		fields: { content, sg_sort_order: null },
		entity: { type: 'Shot', id: 1 },
		templateTask: null,
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-01T00:00:00Z',
		...o
	};
}

const edge = (id: number, downstream: number, upstream: number, o: Partial<Edge> = {}): Edge => ({
	id,
	downstream,
	upstream,
	type: 'finish-to-start-next-day',
	offsetDays: null,
	...o
});

function snap(tasks: EntityTask[], edges: Edge[] = [], template: { id: number; name?: string } | null = null): EntitySnapshot {
	return {
		entity: { type: 'Shot', id: 1, name: 'sh1', entityType: 'Shot', taskTemplate: template && { type: 'TaskTemplate', ...template } },
		tasks,
		edges,
		usage: {},
		readAt: '2026-09-25T14:00:00Z'
	};
}

describe('snapshotChanges', () => {
	it('finds nothing between two reads of an unchanged entity', () => {
		const s = snap([task(10, 'Comp'), task(11, 'Roto')], [edge(100, 10, 11)]);
		expect(snapshotChanges(s, structuredClone(s))).toEqual([]);
	});

	it('ignores dates, usage and pins: other entities of the run move dates by cascade (092)', () => {
		const a = snap([task(10, 'Comp')]);
		const b = snap([task(10, 'Comp', { startDate: '2026-10-01', dueDate: '2026-10-03', pinned: true, dependencyViolation: true })]);
		b.usage = { 10: { versions: 2, publishedFiles: 1 } };
		expect(snapshotChanges(a, b)).toEqual([]);
	});

	it('names a Task deleted out of band, and the edges that went with it (QA: Roto #47844)', () => {
		const a = snap([task(10, 'Comp'), task(47844, 'Roto')], [edge(100, 10, 47844)]);
		const b = snap([task(10, 'Comp')]);
		expect(snapshotChanges(a, b)).toEqual([
			{ code: 'task_removed', task: { id: 47844, name: 'Roto' } },
			{ code: 'edge_removed', downstream: { id: 10, name: 'Comp' }, upstream: { id: 47844, name: 'Roto' } }
		]);
	});

	it('reads a landed apply: the template, created Tasks, links and edges', () => {
		const a = snap([task(10, 'Comp')], [], { id: 1, name: 'T1' });
		const b = snap(
			[task(10, 'Comp', { templateTask: { id: 500, templateId: 2 } }), task(12, 'Roto', { templateTask: { id: 501, templateId: 2 } })],
			[edge(101, 10, 12)],
			{ id: 2, name: 'T2' }
		);
		expect(snapshotChanges(a, b)).toEqual([
			{ code: 'template', from: { type: 'TaskTemplate', id: 1, name: 'T1' }, to: { type: 'TaskTemplate', id: 2, name: 'T2' } },
			{ code: 'task_added', task: { id: 12, name: 'Roto' } },
			{ code: 'task_changed', task: { id: 10, name: 'Comp' }, fields: ['template_task'] },
			{ code: 'edge_added', downstream: { id: 10, name: 'Comp' }, upstream: { id: 12, name: 'Roto' } }
		]);
	});

	it('lists the fields that changed on a Task: name, Step, status, assignees, fields under policy', () => {
		const a = snap([task(10, 'Comp')]);
		const b = snap([
			task(10, 'Comp v2', {
				step: { type: 'Step', id: 8, name: 'Light' },
				status: 'ip',
				assignees: [{ type: 'HumanUser', id: 3 }],
				fields: { content: 'Comp v2', sg_sort_order: 20 }
			})
		]);
		expect(snapshotChanges(a, b)).toEqual([
			{ code: 'task_changed', task: { id: 10, name: 'Comp v2' }, fields: ['content', 'step', 'sg_status_list', 'task_assignees', 'sg_sort_order'] }
		]);
	});

	it('an edge with a new type or offset on the same row is changed', () => {
		const a = snap([task(10, 'Comp'), task(11, 'Roto')], [edge(100, 10, 11)]);
		const b = snap([task(10, 'Comp'), task(11, 'Roto')], [edge(100, 10, 11, { offsetDays: 0 })]);
		expect(snapshotChanges(a, b)).toEqual([{ code: 'edge_changed', downstream: { id: 10, name: 'Comp' }, upstream: { id: 11, name: 'Roto' } }]);
	});
});

describe('describeChanges', () => {
	it('says each kind once, with names and ids, plurals right', () => {
		const a = snap([task(10, 'Comp'), task(47844, 'Roto')], [edge(100, 10, 47844)], { id: 1, name: 'T1' });
		const b = snap(
			[task(10, 'Comp', { status: 'ip' }), task(12, 'Roto'), task(13, 'Paint')],
			[edge(101, 10, 12), edge(102, 10, 13)],
			{ id: 2, name: 'T2' }
		);
		expect(describeChanges(snapshotChanges(a, b), { sg_status_list: 'Status' })).toEqual([
			'Template T1 changed to T2.',
			'2 Tasks created: Roto #12, Paint #13.',
			'1 Task deleted: Roto #47844.',
			'Comp #10: Status.',
			'2 dependencies added, 1 removed.'
		]);
	});

	it('names fields in plain words when the schema gives no label', () => {
		const a = snap([task(10, 'Comp')], [], null);
		const b = snap([task(10, 'Comp', { templateTask: { id: 5, templateId: 2 } })], [], { id: 2 });
		expect(describeChanges(snapshotChanges(a, b))).toEqual(['Template set to template #2.', 'Comp #10: template task.']);
	});
});
