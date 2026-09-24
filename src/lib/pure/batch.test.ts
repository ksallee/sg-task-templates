import { describe, expect, it } from 'vitest';
import {
	buildAfterApply,
	buildEntityWrite,
	claimRequests,
	edgeKeepRequests,
	extraRequests,
	templateRequests,
	validateRequests,
	writeBackRequests
} from './batch';
import { matchKey } from './matching';
import type {
	AffectedEdge,
	BatchRequest,
	ClaimRow,
	ConflictRow,
	CreateRow,
	Edge,
	EntityPlan,
	EntityTask,
	ExtraAction,
	ExtraRow,
	FieldChange,
	Id,
	KeepRow,
	ProjectContext,
	RunOptions,
	TemplateTask
} from './types';

// Hand-made plans. Ids follow recipe 015: Shot 7557, template tt2 = 202 (comp 3001, roto 3002,
// paint 3003), Steps Animation 11, Comp 13, FX 14.

const SHOT = { type: 'Shot', id: 7557, name: 'sh010' };

function core(id: Id, content: string, stepId: number) {
	return {
		id,
		content,
		step: { type: 'Step', id: stepId, name: `step${stepId}` },
		key: matchKey(content, stepId),
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
		fields: {}
	};
}

const tt = (id: Id, content: string, stepId: number): TemplateTask => ({
	...core(id, content, stepId),
	templateId: 202
});

function task(id: Id, content: string, stepId: number, link: Id | null = null): EntityTask {
	return {
		...core(id, content, stepId),
		entity: SHOT,
		templateTask: link === null ? null : { id: link, templateId: null },
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-02T15:58:21Z'
	};
}

const TT_COMP = tt(3001, 'comp', 11);
const TT_ROTO = tt(3002, 'roto', 13);
const TT_PAINT = tt(3003, 'paint', 14);

function change(field: string, current: unknown, template: unknown, policy: FieldChange['policy']): FieldChange {
	const empty = current === null || current === '' || (Array.isArray(current) && current.length === 0);
	const result = policy === 'overwrite' || (policy === 'fill_if_empty' && empty) ? template : current;
	return { field, current, template, policy, result };
}

const keep = (t: EntityTask, tpl: TemplateTask, fieldChanges: FieldChange[] = []): KeepRow => ({
	kind: 'keep',
	task: t,
	templateTask: tpl,
	keyMismatch: false,
	fieldChanges,
	rename: null
});

const claim = (t: EntityTask, tpl: TemplateTask, fieldChanges: FieldChange[] = []): ClaimRow => ({
	kind: 'claim',
	task: t,
	templateTask: tpl,
	previousTemplateTask: t.templateTask,
	fieldChanges,
	rename: null
});

const create = (tpl: TemplateTask, datesClearable = true): CreateRow => ({
	kind: 'create',
	templateTask: tpl,
	templateDates: { start: '2026-03-02', due: '2026-03-03' },
	datesClearable
});

const extra = (t: EntityTask, action: ExtraAction): ExtraRow => ({
	kind: 'extra',
	task: t,
	action,
	usage: { versions: 0, publishedFiles: 0 },
	reason: 'not_in_template'
});

const edge = (id: Id | null, downstream: Id, upstream: Id, type: Edge['type'] = 'finish-to-start-next-day', offsetDays: number | null = null): Edge => ({
	id,
	downstream,
	upstream,
	type,
	offsetDays
});

function plan(p: Partial<EntityPlan> = {}): EntityPlan {
	return {
		entity: { ...SHOT, entityType: 'Shot', taskTemplate: null },
		templateId: 202,
		rows: [],
		edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
		counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false,
		...p
	};
}

const OPTS: RunOptions = {
	fieldPolicies: {},
	extraByName: {},
	extraOverrides: {},
	omitStatus: 'omt',
	conflictPicks: {},
	edgeActions: {},
	clearCreatedDates: false,
	deleteConfirmed: false
};

const CTX: ProjectContext = {
	project: { type: 'Project', id: 1234, name: 'sandbox' },
	defaultTaskStatus: 'wtg',
	validTaskStatuses: ['wtg', 'ip', 'fin', 'omt']
};

const upd = (entity: string, record_id: number, data: Record<string, unknown>): BatchRequest => ({
	request_type: 'update',
	entity,
	record_id,
	data
});

const TPL = { type: 'TaskTemplate', id: 202 };

describe('claimRequests', () => {
	it('claims write only template_task', () => {
		const p = plan({ rows: [claim(task(5001, 'comp', 11, 9001), TT_COMP, [change('sg_description', 'a', 'b', 'overwrite')])] });
		expect(claimRequests(p)).toEqual([upd('Task', 5001, { template_task: { type: 'Task', id: 3001 } })]);
	});

	it('writes nothing for a kept task', () => {
		expect(claimRequests(plan({ rows: [keep(task(5001, 'comp', 11, 3001), TT_COMP)] }))).toEqual([]);
	});

	it('claims the pick of a conflict unless it is already linked', () => {
		const a = task(5001, 'comp', 11);
		const b = task(5002, 'comp', 11);
		const conflict: ConflictRow = {
			kind: 'conflict',
			key: a.key,
			templateTasks: [TT_COMP],
			candidates: [
				{ task: a, usage: { versions: 1, publishedFiles: 0 } },
				{ task: b, usage: { versions: 0, publishedFiles: 0 } }
			],
			prePick: { 3001: 5001 },
			reason: 'usage',
			pick: { 3001: 5002 }
		};
		expect(claimRequests(plan({ rows: [conflict] }))).toEqual([
			upd('Task', 5002, { template_task: { type: 'Task', id: 3001 } })
		]);
		expect(claimRequests(plan({ rows: [{ ...conflict, pick: { 3001: null } }] }))).toEqual([]);
	});

	it('claims a conflict pick once when the planner also lists it as a claim row', () => {
		const a = task(5001, 'comp', 11);
		const conflict: ConflictRow = {
			kind: 'conflict',
			key: a.key,
			templateTasks: [TT_COMP],
			candidates: [{ task: a, usage: { versions: 0, publishedFiles: 0 } }],
			prePick: { 3001: 5001 },
			reason: 'only',
			pick: { 3001: 5001 }
		};
		expect(claimRequests(plan({ rows: [claim(a, TT_COMP), conflict] }))).toHaveLength(1);
	});
});

describe('templateRequests', () => {
	it('sets task_template on the entity by its schema name', () => {
		expect(templateRequests(plan())).toEqual([upd('Shot', 7557, { task_template: TPL })]);
	});

	it('clears task_template first only when already equal', () => {
		expect(templateRequests(plan({ needsClearFirst: true }))).toEqual([
			upd('Shot', 7557, { task_template: null }),
			upd('Shot', 7557, { task_template: TPL })
		]);
	});
});

describe('writeBackRequests', () => {
	it('writes back kept values, one request per task', () => {
		const p = plan({
			rows: [
				keep(task(5001, 'comp', 11, 3001), TT_COMP, [
					change('sg_description', 'mine', 'template text', 'keep'),
					change('est_in_mins', 60, 120, 'keep'),
					change('sg_sort_order', 1, 2, 'overwrite')
				])
			]
		});
		expect(writeBackRequests(p)).toEqual([upd('Task', 5001, { sg_description: 'mine', est_in_mins: 60 })]);
	});

	it('writes back a kept null, since the apply fills it', () => {
		const p = plan({ rows: [claim(task(5001, 'comp', 11), TT_COMP, [change('sg_description', null, 'x', 'keep')])] });
		expect(writeBackRequests(p)).toEqual([upd('Task', 5001, { sg_description: null })]);
	});

	it('fill_if_empty writes back a set value and leaves an empty one to the apply', () => {
		const p = plan({
			rows: [
				claim(task(5001, 'comp', 11), TT_COMP, [change('sg_description', 'mine', 'x', 'fill_if_empty')]),
				claim(task(5002, 'paint', 14), TT_PAINT, [change('sg_description', '', 'x', 'fill_if_empty')])
			]
		});
		expect(writeBackRequests(p)).toEqual([upd('Task', 5001, { sg_description: 'mine' })]);
	});

	it('writes a link back as type and id, a multi-entity as a bare list', () => {
		const p = plan({
			rows: [
				keep(task(5001, 'comp', 11, 3001), TT_COMP, [
					change('step', { type: 'Step', id: 13, name: 'Comp' }, { type: 'Step', id: 11, name: 'Animation' }, 'keep'),
					change('task_reviewers', [{ type: 'HumanUser', id: 88, name: 'Kevin' }], [{ type: 'HumanUser', id: 89, name: 'J' }], 'keep')
				])
			]
		});
		expect(writeBackRequests(p)).toEqual([
			upd('Task', 5001, {
				step: { type: 'Step', id: 13 },
				task_reviewers: [{ type: 'HumanUser', id: 88 }]
			})
		]);
	});

	it('writes nothing under overwrite', () => {
		const p = plan({ rows: [keep(task(5001, 'comp', 11, 3001), TT_COMP, [change('content', 'Comp v2', 'comp', 'overwrite')])] });
		expect(writeBackRequests(p)).toEqual([]);
	});
});

describe('edgeKeepRequests', () => {
	const affected = (e: Edge & { id: Id }, cause: AffectedEdge['cause'], action: AffectedEdge['action'] = 'keep'): AffectedEdge => ({
		existing: e,
		cause,
		replacedBy: cause === 'replaced' ? edge(null, e.downstream, e.upstream) : null,
		action
	});

	it('re-creates a kept edge the apply deletes as a TaskDependency row', () => {
		const p = plan({ edges: { ...plan().edges, affected: [affected({ ...edge(701, 5002, 5001, 'start-to-start', 2), id: 701 }, 'not_in_template')] } });
		expect(edgeKeepRequests(p)).toEqual([
			{
				request_type: 'create',
				entity: 'TaskDependency',
				data: {
					task: { type: 'Task', id: 5002 },
					dependent_task: { type: 'Task', id: 5001 },
					dependency_type: 'start-to-start',
					offset_days: 2
				}
			}
		]);
	});

	it('sends nothing for a removed edge or a replaced one (second phase)', () => {
		const p = plan({
			edges: {
				...plan().edges,
				affected: [
					affected({ ...edge(701, 5002, 5001), id: 701 }, 'not_in_template', 'remove'),
					affected({ ...edge(702, 5003, 5001, 'start-to-start'), id: 702 }, 'replaced')
				]
			}
		});
		expect(edgeKeepRequests(p)).toEqual([]);
	});
});

describe('extraRequests', () => {
	it('omit writes the chosen status', () => {
		const p = plan({ rows: [extra(task(5009, 'roto', 12), 'omit')] });
		expect(extraRequests(p, OPTS, CTX)).toEqual([upd('Task', 5009, { sg_status_list: 'omt' })]);
	});

	it('omit skips a task already at the status', () => {
		const t = { ...task(5009, 'roto', 12), status: 'omt' };
		expect(extraRequests(plan({ rows: [extra(t, 'omit')] }), OPTS, CTX)).toEqual([]);
	});

	it('rejects an omit status outside the project valid set', () => {
		const p = plan({ rows: [extra(task(5009, 'roto', 12), 'omit')] });
		expect(() => extraRequests(p, { ...OPTS, omitStatus: 'nope' }, CTX)).toThrow(/nope/);
	});

	it('delete is absent without confirmation', () => {
		const p = plan({ rows: [extra(task(5009, 'roto', 12), 'delete')] });
		expect(extraRequests(p, OPTS, CTX)).toEqual([]);
		expect(extraRequests(p, { ...OPTS, deleteConfirmed: true }, CTX)).toEqual([
			{ request_type: 'delete', entity: 'Task', record_id: 5009 }
		]);
	});

	it('leave writes nothing', () => {
		expect(extraRequests(plan({ rows: [extra(task(5009, 'roto', 12), 'leave')] }), OPTS, CTX)).toEqual([]);
	});
});

describe('buildEntityWrite', () => {
	const full = plan({
		needsClearFirst: true,
		rows: [
			keep(task(5001, 'comp', 11, 3001), TT_COMP, [change('sg_description', 'mine', 'tpl', 'keep')]),
			claim(task(5002, 'paint', 14, 9003), TT_PAINT),
			create(TT_ROTO),
			extra(task(5009, 'roto', 12), 'omit')
		],
		edges: {
			...plan().edges,
			affected: [
				{ existing: { ...edge(701, 5002, 5001), id: 701 }, cause: 'not_in_template', replacedBy: null, action: 'keep' }
			]
		}
	});

	it('orders claims, clear, set, write-backs, edge keeps, extras in one batch', () => {
		const w = buildEntityWrite(full, OPTS, CTX);
		expect(w.entity).toEqual(SHOT);
		expect(w.batch.map((r) => [r.request_type, r.entity, 'record_id' in r ? r.record_id : null])).toEqual([
			['update', 'Task', 5002],
			['update', 'Shot', 7557],
			['update', 'Shot', 7557],
			['update', 'Task', 5001],
			['create', 'TaskDependency', null],
			['update', 'Task', 5009]
		]);
		expect(validateRequests(w.batch)).toEqual([]);
	});

	it('never creates a Task', () => {
		const w = buildEntityWrite(full, OPTS, CTX);
		expect(w.batch.filter((r) => r.request_type === 'create' && r.entity === 'Task')).toEqual([]);
	});

	it('lists created tasks for date clearing only on opt-in and when clearable', () => {
		const p = plan({ rows: [create(TT_ROTO), create(TT_PAINT, false)] });
		expect(buildEntityWrite(p, OPTS, CTX).clearDatesFor).toEqual([]);
		expect(buildEntityWrite(p, { ...OPTS, clearCreatedDates: true }, CTX).clearDatesFor).toEqual([3002]);
	});

	it('noop plan builds no batch', () => {
		expect(buildEntityWrite(plan({ noop: true, rows: [keep(task(5001, 'comp', 11, 3001), TT_COMP)] }), OPTS, CTX).batch).toEqual([]);
	});
});

describe('buildAfterApply', () => {
	it('clears dates on the created task with no upstream edge', () => {
		const p = plan({ rows: [keep(task(5001, 'comp', 11, 3001), TT_COMP), create(TT_ROTO)] });
		const created = { ...task(6001, 'roto', 13, 3002), startDate: '2026-03-02', dueDate: '2026-03-03' };
		const after = { tasks: [task(5001, 'comp', 11, 3001), created], edges: [] };
		expect(buildAfterApply(p, OPTS, after)).toEqual([]);
		expect(buildAfterApply(p, { ...OPTS, clearCreatedDates: true }, after)).toEqual([
			upd('Task', 6001, { start_date: null, due_date: null })
		]);
	});

	it('does not clear a created task that has an upstream edge after apply (093 pins it)', () => {
		const p = plan({ rows: [keep(task(5001, 'comp', 11, 3001), TT_COMP), create(TT_ROTO)] });
		const created = { ...task(6001, 'roto', 13, 3002), startDate: '2026-03-02', dueDate: '2026-03-03' };
		const after = { tasks: [task(5001, 'comp', 11, 3001), created], edges: [edge(801, 6001, 5001)] };
		expect(buildAfterApply(p, { ...OPTS, clearCreatedDates: true }, after)).toEqual([]);
	});

	it('does not clear a task that already has no dates', () => {
		const p = plan({ rows: [create(TT_ROTO)] });
		const after = { tasks: [task(6001, 'roto', 13, 3002)], edges: [] };
		expect(buildAfterApply(p, { ...OPTS, clearCreatedDates: true }, after)).toEqual([]);
	});

	const replaced: AffectedEdge = {
		existing: { ...edge(702, 5002, 5001, 'start-to-start', 1), id: 702 },
		cause: 'replaced',
		replacedBy: edge(null, 5002, 5001),
		action: 'keep'
	};

	it('keeps a replaced edge: deletes the template copy, then re-creates the old one', () => {
		const p = plan({ edges: { ...plan().edges, affected: [replaced] } });
		const after = { tasks: [], edges: [edge(802, 5002, 5001)] };
		expect(buildAfterApply(p, OPTS, after)).toEqual([
			{ request_type: 'delete', entity: 'TaskDependency', record_id: 802 },
			{
				request_type: 'create',
				entity: 'TaskDependency',
				data: {
					task: { type: 'Task', id: 5002 },
					dependent_task: { type: 'Task', id: 5001 },
					dependency_type: 'start-to-start',
					offset_days: 1
				}
			}
		]);
	});

	it('finds the template copy in the reverse direction', () => {
		const p = plan({ edges: { ...plan().edges, affected: [replaced] } });
		const after = { tasks: [], edges: [edge(803, 5001, 5002)] };
		expect(buildAfterApply(p, OPTS, after)[0]).toEqual({ request_type: 'delete', entity: 'TaskDependency', record_id: 803 });
	});

	it('leaves a replaced edge the apply did not touch, and a removed one', () => {
		const p = plan({ edges: { ...plan().edges, affected: [replaced, { ...replaced, action: 'remove', existing: { ...edge(704, 5003, 5001), id: 704 } }] } });
		const after = { tasks: [], edges: [edge(702, 5002, 5001, 'start-to-start', 1), edge(804, 5003, 5001)] };
		expect(buildAfterApply(p, OPTS, after)).toEqual([]);
	});
});

describe('validateRequests', () => {
	it('rejects a missing record_id', () => {
		const bad = { request_type: 'update', entity: 'Task', data: { x: 1 } } as unknown as BatchRequest;
		expect(validateRequests([bad])).toEqual(['request 0: update without a record_id']);
	});

	it('rejects a Task create, an empty update and a slug entity', () => {
		expect(
			validateRequests([
				{ request_type: 'create', entity: 'Task', data: { content: 'x' } },
				upd('Task', 1, {}),
				upd('tasks', 1, { x: 1 })
			])
		).toEqual([
			'request 0: creates a Task; the apply creates Tasks',
			'request 1: update without data',
			'request 2: entity "tasks" is not a schema name'
		]);
	});

	it('rejects two creates on one dependency pair (085)', () => {
		const dep = (d: number, u: number): BatchRequest => ({
			request_type: 'create',
			entity: 'TaskDependency',
			data: { task: { type: 'Task', id: d }, dependent_task: { type: 'Task', id: u } }
		});
		expect(validateRequests([dep(1, 2), dep(2, 1)])).toEqual(['request 1: a second dependency between Task 1 and Task 2']);
	});
});
