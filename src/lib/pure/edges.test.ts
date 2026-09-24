import { describe, expect, it } from 'vitest';
import { downstreamClosure, mapTasks, planEdges, splitPinned, type TaskMap } from './edges';
import { matchKey } from './matching';
import type { DependencyType, Edge, EntityTask, Id, PlanRow, Template, TemplateTask } from './types';
import templates from './fixtures/recipe015-templates.json';
import shotBefore from './fixtures/recipe015-shot-before.json';
import staleEdge from './fixtures/stale-edge.json';
import edgeDiffers from './fixtures/edge-differs.json';
import pinnedDownstream from './fixtures/S13-pinned-downstream.json';

// Wire -> domain, only what edges.ts reads. read.ts owns the real conversion.
type Json = any;

function edgeOf(row: Json): Edge {
	return {
		id: row.id,
		downstream: row.relationships.task.data.id,
		upstream: row.relationships.dependent_task.data.id,
		type: row.attributes.dependency_type ?? 'finish-to-start-next-day',
		offsetDays: row.attributes.offset_days
	};
}

function coreOf(row: Json) {
	const a = row.attributes;
	const step = row.relationships.step?.data ?? null;
	return {
		id: row.id,
		content: a.content,
		step,
		key: matchKey(a.content, step?.id ?? null),
		status: a.sg_status_list,
		sortOrder: a.sg_sort_order,
		duration: a.duration,
		estInMins: a.est_in_mins,
		description: a.sg_description,
		milestone: a.milestone,
		startDate: a.start_date,
		dueDate: a.due_date,
		assignees: [],
		reviewers: [],
		fields: {}
	};
}

function taskOf(row: Json): EntityTask {
	const link = row.relationships.template_task?.data;
	return {
		...coreOf(row),
		entity: row.relationships.entity.data,
		templateTask: link ? { id: link.id, templateId: null } : null,
		pinned: row.attributes.pinned,
		dependencyViolation: row.attributes.dependency_violation,
		createdAt: row.attributes.created_at
	};
}

const tt2Tasks: TemplateTask[] = (templates as Json).templateTasks
	.filter((t: Json) => t.relationships.task_template.data.id === 202)
	.map((t: Json) => ({ ...coreOf(t), templateId: 202 }));

// tt2 of recipe 015: comp 47201, roto@Comp 47202, paint 47203; edge 47203 on 47201 start-to-start 1.
const tt2: Template = {
	id: 202,
	code: 'tt2',
	entityType: 'Shot',
	tasks: tt2Tasks,
	edges: (templates as Json).templateDependencies.map(edgeOf)
};

const snapshot = (f: Json) => ({ tasks: f.tasks.map(taskOf) as EntityTask[], edges: f.dependencies.map(edgeOf) as Edge[] });

// Recipe 015 plan: claim comp 47296 -> 47201, claim paint 47297 -> 47203, create roto 47202.
const recipe015: TaskMap = new Map([
	[47201, { existing: 47296 }],
	[47203, { existing: 47297 }],
	[47202, { created: 47202 }]
]);

// --- synthetic graphs ---------------------------------------------------------------------------

let nextId = 9500;
function e(downstream: Id, upstream: Id, type: DependencyType = 'finish-to-start-next-day', offsetDays: number | null = null, id: Id | null = nextId++): Edge {
	return { id, downstream, upstream, type, offsetDays };
}

function t(id: Id, opts: { pinned?: boolean } = {}): EntityTask {
	return {
		id,
		content: `t${id}`,
		step: null,
		key: matchKey(`t${id}`, null),
		status: 'wtg',
		sortOrder: null,
		duration: null,
		estInMins: null,
		description: null,
		milestone: false,
		startDate: '2026-03-02',
		dueDate: '2026-03-03',
		assignees: [],
		reviewers: [],
		fields: {},
		entity: { type: 'Shot', id: 1, name: 'sh' },
		templateTask: null,
		pinned: opts.pinned ?? false,
		dependencyViolation: false,
		createdAt: '2026-09-02T15:58:21Z'
	};
}

function template(edges: Edge[], ids: Id[]): Template {
	return {
		id: 1,
		code: 'T',
		entityType: 'Shot',
		tasks: ids.map((id) => ({ ...t(id), templateId: 1 })),
		edges
	};
}

// Template tasks 1, 2, 3 map to Tasks 101, 102, 103.
const map123: TaskMap = new Map([
	[1, { existing: 101 }],
	[2, { existing: 102 }],
	[3, { existing: 103 }]
]);

describe('mapTasks', () => {
	it('maps keep, claim and create ends to template tasks', () => {
		const rows = [
			{ kind: 'keep', task: t(101), templateTask: tt2Tasks[0] },
			{ kind: 'claim', task: t(103), templateTask: tt2Tasks[2] },
			{ kind: 'create', templateTask: tt2Tasks[1] },
			{ kind: 'extra', task: t(104) }
		] as unknown as PlanRow[];
		expect(mapTasks(rows)).toEqual(
			new Map([
				[47201, { existing: 101 }],
				[47203, { existing: 103 }],
				[47202, { created: 47202 }]
			])
		);
	});

	it('maps a conflict by its pick, null to a created Task', () => {
		const rows = [
			{ kind: 'conflict', templateTasks: [tt2Tasks[0], tt2Tasks[1]], pick: { 47201: 105, 47202: null } }
		] as unknown as PlanRow[];
		expect(mapTasks(rows)).toEqual(
			new Map([
				[47201, { existing: 105 }],
				[47202, { created: 47202 }]
			])
		);
	});
});

describe('planEdges: added', () => {
	it('fixture recipe 015: expects paint on comp start-to-start 1 between two claimed Tasks (092)', () => {
		const { tasks, edges } = snapshot(shotBefore);
		const plan = planEdges({ template: tt2, tasks, edges, mapping: recipe015 });
		expect(plan.expectedAdded).toEqual([
			{ templateEdge: tt2.edges[0], downstream: { existing: 47297 }, upstream: { existing: 47296 } }
		]);
		expect(plan.affected).toEqual([]);
		expect(plan.toExtras).toEqual([]);
	});

	it('does not expect an edge that already exists', () => {
		const have = e(101, 102, 'start-to-start', 2);
		const plan = planEdges({ template: template([e(1, 2, 'start-to-start', 2)], [1, 2]), tasks: [t(101), t(102)], edges: [have], mapping: map123 });
		expect(plan.expectedAdded).toEqual([]);
		expect(plan.affected).toEqual([]);
		expect(plan.mayMove).toEqual([]);
	});

	it('expects an edge to a created task (099)', () => {
		const mapping: TaskMap = new Map([
			[1, { existing: 101 }],
			[2, { created: 2 }]
		]);
		const tpl = e(2, 1);
		const plan = planEdges({ template: template([tpl], [1, 2]), tasks: [t(101)], edges: [], mapping });
		expect(plan.expectedAdded).toEqual([{ templateEdge: tpl, downstream: { created: 2 }, upstream: { existing: 101 } }]);
	});

	it('skips a template edge with an unmapped end', () => {
		const mapping: TaskMap = new Map([[1, { existing: 101 }]]);
		const plan = planEdges({ template: template([e(2, 1)], [1, 2]), tasks: [t(101)], edges: [], mapping });
		expect(plan.expectedAdded).toEqual([]);
	});
});

describe('planEdges: deleted and replaced', () => {
	it('flags an edge between mapped tasks the template lacks: deleted by the apply, keep by default (102)', () => {
		const stray = e(103, 101);
		const plan = planEdges({ template: template([e(2, 1)], [1, 2, 3]), tasks: [t(101), t(102), t(103)], edges: [stray], mapping: map123 });
		expect(plan.affected).toEqual([{ existing: stray, cause: 'not_in_template', replacedBy: null, action: 'keep' }]);
	});

	it('fixture stale-edge: the reverse edge comp on paint is replaced by the template edge (101)', () => {
		const { tasks, edges } = snapshot(staleEdge);
		const plan = planEdges({ template: tt2, tasks, edges, mapping: recipe015 });
		expect(plan.affected).toEqual([
			{
				existing: edges[0],
				cause: 'replaced',
				replacedBy: { ...tt2.edges[0], id: null, downstream: 47297, upstream: 47296 },
				action: 'keep'
			}
		]);
		// The server writes the template's copy in its place.
		expect(plan.expectedAdded).toHaveLength(1);
	});

	it('fixture edge-differs: same pair, other type is replaced (101)', () => {
		const { tasks, edges } = snapshot(edgeDiffers);
		const plan = planEdges({ template: tt2, tasks, edges, mapping: recipe015 });
		expect(plan.affected.map((a) => [a.existing.id, a.cause])).toEqual([[9103, 'replaced']]);
	});

	it('same pair and type, other offset is replaced (102)', () => {
		const have = e(102, 101, 'start-to-start', 3);
		const plan = planEdges({ template: template([e(2, 1, 'start-to-start', 2)], [1, 2]), tasks: [t(101), t(102)], edges: [have], mapping: map123 });
		expect(plan.affected.map((a) => a.cause)).toEqual(['replaced']);
		expect(plan.expectedAdded).toHaveLength(1);
	});

	it('takes the action from edgeActions by TaskDependency id', () => {
		const stray = e(103, 101);
		const plan = planEdges({
			template: template([], [1, 2, 3]),
			tasks: [t(101), t(102), t(103)],
			edges: [stray],
			mapping: map123,
			edgeActions: { [stray.id!]: 'remove' }
		});
		expect(plan.affected[0].action).toBe('remove');
	});
});

describe('planEdges: left alone', () => {
	it('lists an edge between an extra and a mapped Task, never touches it (101 control)', () => {
		const ctl = e(104, 101);
		const plan = planEdges({ template: template([], [1, 2]), tasks: [t(101), t(102), t(104)], edges: [ctl], mapping: map123 });
		expect(plan.toExtras).toEqual([ctl]);
		expect(plan.affected).toEqual([]);
	});

	it('keeps an edge between two extras apart, untouched (102)', () => {
		const both = e(105, 104);
		const plan = planEdges({ template: template([], [1]), tasks: [t(101), t(104), t(105)], edges: [both], mapping: map123 });
		expect(plan.untouched).toEqual([both]);
		expect(plan.toExtras).toEqual([]);
	});
});

describe('planEdges: date impact, graph level (092)', () => {
	it('an added edge may move its unpinned downstream Task and the chain below it (087 cascade)', () => {
		// template: 102 on 101. Site: 104 (extra) on 102, 105 on 104.
		const plan = planEdges({
			template: template([e(2, 1)], [1, 2]),
			tasks: [t(101), t(102), t(104), t(105)],
			edges: [e(104, 102), e(105, 104)],
			mapping: map123
		});
		expect(plan.mayMove).toEqual([102, 104, 105]);
		expect(plan.wouldViolate).toEqual([]);
	});

	it('the upstream end does not move', () => {
		const plan = planEdges({ template: template([e(2, 1)], [1, 2]), tasks: [t(101), t(102)], edges: [], mapping: map123 });
		expect(plan.mayMove).not.toContain(101);
	});

	it('fixture S13: a pinned downstream Task holds and would flag dependency_violation', () => {
		const { tasks, edges } = snapshot(pinnedDownstream);
		const plan = planEdges({ template: tt2, tasks, edges, mapping: recipe015 });
		expect(plan.mayMove).toEqual([]);
		expect(plan.wouldViolate).toEqual([47297]);
	});

	it('a pinned Task stops the cascade below it', () => {
		const plan = planEdges({
			template: template([e(2, 1)], [1, 2]),
			tasks: [t(101), t(102, { pinned: true }), t(104)],
			edges: [e(104, 102)],
			mapping: map123
		});
		expect(plan.wouldViolate).toEqual([102]);
		expect(plan.mayMove).toEqual([]);
	});

	it('flags a pinned Task further down a moving chain', () => {
		const plan = planEdges({
			template: template([e(2, 1)], [1, 2]),
			tasks: [t(101), t(102), t(104, { pinned: true })],
			edges: [e(104, 102)],
			mapping: map123
		});
		expect(plan.mayMove).toEqual([102]);
		expect(plan.wouldViolate).toEqual([104]);
	});

	it('cascades through a created Task without listing it', () => {
		// template: 2 on 1, 3 on 2; 2 is created, 103 kept.
		const mapping: TaskMap = new Map([
			[1, { existing: 101 }],
			[2, { created: 2 }],
			[3, { existing: 103 }]
		]);
		const plan = planEdges({ template: template([e(2, 1), e(3, 2)], [1, 2, 3]), tasks: [t(101), t(103)], edges: [], mapping });
		expect(plan.mayMove).toEqual([103]);
	});

	it('a kept not-in-template edge is re-created: its downstream may move', () => {
		const stray = e(103, 101);
		const plan = planEdges({ template: template([], [1, 2, 3]), tasks: [t(101), t(102), t(103)], edges: [stray], mapping: map123 });
		expect(plan.mayMove).toEqual([103]);
	});

	it('a removed edge moves nothing (095: dates unchanged on delete)', () => {
		const stray = e(103, 101);
		const plan = planEdges({
			template: template([], [1, 2, 3]),
			tasks: [t(101), t(102), t(103)],
			edges: [stray],
			mapping: map123,
			edgeActions: { [stray.id!]: 'remove' }
		});
		expect(plan.mayMove).toEqual([]);
	});

	it('keep of a replaced reverse edge: the old direction stands, its downstream may move, not the template one', () => {
		// template: 102 on 101. Site: 101 on 102 (reverse), kept -> template copy deleted, old re-created.
		const rev = e(101, 102);
		const plan = planEdges({ template: template([e(2, 1)], [1, 2]), tasks: [t(101), t(102)], edges: [rev], mapping: map123 });
		expect(plan.mayMove).toEqual([101]);
	});

	it('remove of a replaced reverse edge: the template edge stands', () => {
		const rev = e(101, 102);
		const plan = planEdges({
			template: template([e(2, 1)], [1, 2]),
			tasks: [t(101), t(102)],
			edges: [rev],
			mapping: map123,
			edgeActions: { [rev.id!]: 'remove' }
		});
		expect(plan.mayMove).toEqual([102]);
	});
});

describe('downstreamClosure', () => {
	it('follows chains and stops at cycles', () => {
		const edges = [e(2, 1), e(3, 2), e(1, 3), e(4, 3)];
		expect(downstreamClosure([1], edges)).toEqual([2, 3, 4]);
	});
	it('leaves the start Tasks out', () => {
		expect(downstreamClosure([1, 2], [e(2, 1), e(3, 2)])).toEqual([3]);
	});
});

describe('splitPinned', () => {
	it('splits ids into pinned and unpinned', () => {
		expect(splitPinned([101, 102], [t(101), t(102, { pinned: true })])).toEqual({ unpinned: [101], pinned: [102] });
	});
});
