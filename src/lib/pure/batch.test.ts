import { describe, expect, it } from 'vitest';
import {
	buildAfterApply,
	buildEntityWrite,
	claimRequests,
	edgeKeepRequests,
	extraRequests,
	templateRequests,
	unlinkRequests,
	validateRequests,
	writeBackRequests
} from './batch';
import { matchKey } from './matching';
import { planEntity, withConflictPick } from './planner';
import type {
	AffectedEdge,
	BatchRequest,
	ClaimRow,
	ConflictRow,
	CreateRow,
	Edge,
	EntityPlan,
	EntitySnapshot,
	EntityTask,
	ExtraAction,
	ExtraRow,
	FieldChange,
	Id,
	KeepRow,
	ProjectContext,
	RunOptions,
	Template,
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

	it('never re-creates a kept edge with an end the run deletes: removed with the extra (103)', () => {
		const p = plan({
			rows: [extra(task(5009, 'roto', 12), 'delete')],
			edges: {
				...plan().edges,
				affected: [
					affected({ ...edge(701, 5002, 5009), id: 701 }, 'not_in_template'),
					affected({ ...edge(705, 5002, 5001), id: 705 }, 'outside_upstream')
				]
			}
		});
		expect(edgeKeepRequests(p).map((r) => r.request_type === 'create' && r.data.dependent_task)).toEqual([
			{ type: 'Task', id: 5001 }
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
		expect(() => extraRequests(p, { ...OPTS, omitStatus: 'nope' }, CTX)).toThrow('"nope" is not a Task status in this project. Pick the status omitted Tasks take.');
	});

	it('delete retires the Task', () => {
		const p = plan({ rows: [extra(task(5009, 'roto', 12), 'delete')] });
		expect(extraRequests(p, OPTS, CTX)).toEqual([
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

	const transient = (a: AffectedEdge) => ({
		templateEdge: a.replacedBy!,
		downstream: { existing: a.existing.downstream },
		upstream: { existing: a.existing.upstream },
		keptEdge: a.existing.id
	});
	const withReplaced = (...as: AffectedEdge[]) =>
		plan({ edges: { ...plan().edges, affected: as, transientAdded: as.map(transient) } });

	it('keeps a replaced edge: deletes the template copy, then re-creates the old one', () => {
		const p = withReplaced(replaced);
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
		const p = withReplaced(replaced);
		const after = { tasks: [], edges: [edge(803, 5001, 5002)] };
		expect(buildAfterApply(p, OPTS, after)[0]).toEqual({ request_type: 'delete', entity: 'TaskDependency', record_id: 803 });
	});

	it('leaves a replaced edge the apply did not touch, and a removed one', () => {
		const p = withReplaced(replaced, { ...replaced, action: 'remove', existing: { ...edge(704, 5003, 5001), id: 704 } });
		const after = { tasks: [], edges: [edge(702, 5002, 5001, 'start-to-start', 1), edge(804, 5003, 5001)] };
		expect(buildAfterApply(p, OPTS, after)).toEqual([]);
	});
});

describe('buildAfterApply: transient template copies', () => {
	const replaced: AffectedEdge = {
		existing: { ...edge(702, 5002, 5001, 'start-to-start', 1), id: 702 },
		cause: 'replaced',
		replacedBy: edge(null, 5002, 5001),
		action: 'keep'
	};
	const copy = { templateEdge: edge(900, 3003, 3001), downstream: { existing: 5002 }, upstream: { existing: 5001 }, keptEdge: 702 };

	it('acts on transientAdded, not on replaced edges without a template copy', () => {
		const after = { tasks: [], edges: [edge(802, 5002, 5001)] };
		expect(buildAfterApply(plan({ edges: { ...plan().edges, affected: [replaced] } }), OPTS, after)).toEqual([]);
		const p = plan({ edges: { ...plan().edges, affected: [replaced], transientAdded: [copy] } });
		expect(buildAfterApply(p, OPTS, after).map((r) => r.request_type)).toEqual(['delete', 'create']);
	});

	it('never re-creates an edge marked closesLoop, and leaves the template copy', () => {
		const loop: AffectedEdge = { ...replaced, closesLoop: true };
		const p = plan({ edges: { ...plan().edges, affected: [loop], transientAdded: [copy] } });
		expect(buildAfterApply(p, OPTS, { tasks: [], edges: [edge(802, 5002, 5001)] })).toEqual([]);
	});
});

// Plans from planEntity. Template 202: comp 3001 @11, roto 3002 @13, paint 3003 @14;
// comp depends on paint, start-to-start +1 (recipe 015's shape).
describe('from planEntity', () => {
	const tpl: Template = {
		id: 202,
		code: 'tt2',
		entityType: 'Shot',
		tasks: [
			{ ...TT_COMP, sortOrder: 10 },
			{ ...TT_ROTO, sortOrder: 20 },
			{ ...TT_PAINT, sortOrder: 30 }
		],
		edges: [edge(900, 3001, 3003, 'start-to-start', 1)]
	};
	const linked = (id: Id, content: string, stepId: number, link: Id, createdAt = '2026-09-02T15:58:21Z'): EntityTask => ({
		...task(id, content, stepId),
		templateTask: { id: link, templateId: 202 },
		createdAt
	});
	const snap = (tasks: EntityTask[], edges: Edge[] = [], taskTemplate: Id | null = null): EntitySnapshot => ({
		entity: { ...SHOT, entityType: 'Shot', taskTemplate: taskTemplate === null ? null : { type: 'TaskTemplate', id: taskTemplate } },
		tasks,
		edges,
		usage: {},
		readAt: '2026-09-24T10:00:00Z'
	});
	const creates = (reqs: BatchRequest[]) =>
		reqs.flatMap((r) =>
			r.request_type === 'create' && r.entity === 'TaskDependency'
				? [[(r.data.task as { id: Id }).id, (r.data.dependent_task as { id: Id }).id]]
				: []
		);
	const shotWrite = (reqs: BatchRequest[]) =>
		reqs.findIndex((r) => r.entity === 'Shot' && r.request_type === 'update' && r.data.task_template !== null);

	describe('106: conflict losers linked to the template task', () => {
		const tasks = () => [
			linked(5001, 'comp', 11, 3001),
			linked(5003, 'paint', 14, 3003, '2026-01-01T00:00:00Z'),
			linked(5004, 'paint', 14, 3003, '2026-02-01T00:00:00Z')
		];

		it('unlinks the loser before the template write', () => {
			const p = planEntity(tpl, snap(tasks()), CTX, OPTS);
			expect(p.rows.find((r) => r.kind === 'extra')).toMatchObject({ reason: 'conflict_loser', task: { id: 5004 } });
			const w = buildEntityWrite(p, OPTS, CTX);
			const i = w.batch.findIndex((r) => r.request_type === 'update' && r.record_id === 5004 && r.data.template_task === null);
			expect(i).toBeGreaterThanOrEqual(0);
			expect(i).toBeLessThan(shotWrite(w.batch));
			expect(unlinkRequests(p)).toEqual([upd('Task', 5004, { template_task: null })]);
		});

		it('unlinks whichever Task loses to the user pick', () => {
			const p = planEntity(tpl, snap(tasks()), CTX, withConflictPick(OPTS, 3003, 5004));
			expect(unlinkRequests(p)).toEqual([upd('Task', 5003, { template_task: null })]);
		});

		it('leaves a loser that is not linked to the conflict template task', () => {
			const t = [linked(5001, 'comp', 11, 3001), task(5003, 'paint', 14), task(5004, 'paint', 14, 9003)];
			const p = planEntity(tpl, snap(t), CTX, OPTS);
			expect(p.rows.filter((r) => r.kind === 'extra' && r.reason === 'conflict_loser')).toHaveLength(1);
			expect(unlinkRequests(p)).toEqual([]);
		});
	});

	describe('109: outside-upstream edges', () => {
		// comp and paint kept; roto @12 an extra. comp on roto: outside upstream, erased by the apply.
		// roto on paint: the outside Task downstream, kept by the apply.
		const tasks = () => [linked(5001, 'comp', 11, 3001), linked(5003, 'paint', 14, 3003), task(5009, 'roto', 12)];
		const edges = [edge(900 + 1, 5001, 5003, 'start-to-start', 1), edge(701, 5001, 5009), edge(702, 5009, 5003)];

		it('keep re-creates it after the template write, like not_in_template', () => {
			const p = planEntity(tpl, snap(tasks(), edges), CTX, OPTS);
			expect(p.edges.affected.map((a) => [a.existing.id, a.cause, a.action])).toEqual([[701, 'outside_upstream', 'keep']]);
			const w = buildEntityWrite(p, OPTS, CTX);
			expect(creates(w.batch)).toEqual([[5001, 5009]]);
			const i = w.batch.findIndex((r) => r.request_type === 'create');
			expect(i).toBeGreaterThan(shotWrite(w.batch));
			expect(validateRequests(w.batch, p)).toEqual([]);
		});

		it('remove sends nothing: the apply erases it', () => {
			const p = planEntity(tpl, snap(tasks(), edges), CTX, { ...OPTS, edgeActions: { 701: 'remove' } });
			expect(creates(buildEntityWrite(p, OPTS, CTX).batch)).toEqual([]);
		});

		it('is not re-created when the batch deletes the outside Task', () => {
			const o = { ...OPTS, extraOverrides: { 5009: 'delete' as const }, edgeActions: { 701: 'keep' as const } };
			const p = planEntity(tpl, snap(tasks(), edges), CTX, o);
			expect(p.edges.affected).toEqual([]);
			expect(p.edges.withDeleted?.map((w) => [w.edge.id, w.task])).toEqual([
				[701, 5009],
				[702, 5009]
			]);
			const w = buildEntityWrite(p, o, CTX);
			expect(creates(w.batch)).toEqual([]);
			expect(w.batch.filter((r) => r.entity === 'TaskDependency')).toEqual([]);
			expect(validateRequests(w.batch, p)).toEqual([]);
			expect(w.batch.at(-1)).toEqual({ request_type: 'delete', entity: 'Task', record_id: 5009 });
		});

		it('never re-creates an edge marked closesLoop, even under keep', () => {
			const p = planEntity(tpl, snap(tasks(), edges), CTX, OPTS);
			const loop = { ...p.edges, affected: p.edges.affected.map((a) => ({ ...a, action: 'keep' as const, closesLoop: true as const })) };
			expect(edgeKeepRequests({ ...p, edges: loop })).toEqual([]);
		});
	});

	describe('replaced edges: transient template copies', () => {
		// comp on paint exists as finish-to-start; the template's is start-to-start +1.
		const tasks = () => [linked(5001, 'comp', 11, 3001), linked(5003, 'paint', 14, 3003)];
		const edges = [edge(703, 5001, 5003)];

		it('keep: the copy is transient, deleted after the apply, and the old edge re-created', () => {
			const p = planEntity(tpl, snap(tasks(), edges), CTX, OPTS);
			expect(p.edges.expectedAdded).toEqual([]);
			expect(p.edges.transientAdded).toHaveLength(1);
			expect(creates(buildEntityWrite(p, OPTS, CTX).batch)).toEqual([]);
			const after = { tasks: tasks(), edges: [edge(810, 5001, 5003, 'start-to-start', 1)] };
			expect(buildAfterApply(p, OPTS, after)).toEqual([
				{ request_type: 'delete', entity: 'TaskDependency', record_id: 810 },
				{
					request_type: 'create',
					entity: 'TaskDependency',
					data: {
						task: { type: 'Task', id: 5001 },
						dependent_task: { type: 'Task', id: 5003 },
						dependency_type: 'finish-to-start-next-day',
						offset_days: null
					}
				}
			]);
		});

		it('remove: the template copy survives, nothing after the apply', () => {
			const o = { ...OPTS, edgeActions: { 703: 'remove' as const } };
			const p = planEntity(tpl, snap(tasks(), edges), CTX, o);
			expect(p.edges.expectedAdded).toHaveLength(1);
			expect(buildAfterApply(p, o, { tasks: tasks(), edges: [edge(810, 5001, 5003, 'start-to-start', 1)] })).toEqual([]);
		});

		it('104: rejects a batch that deletes an edge the template write erases', () => {
			const p = planEntity(tpl, snap(tasks(), edges), CTX, OPTS);
			const batch = [...buildEntityWrite(p, OPTS, CTX).batch, { request_type: 'delete', entity: 'TaskDependency', record_id: 703 } as BatchRequest];
			expect(validateRequests(batch, p)).toEqual([
				`request ${batch.length - 1}: deletes TaskDependency 703, which the template write erases (404, 104)`
			]);
			expect(validateRequests(batch)).toEqual([]);
		});
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
