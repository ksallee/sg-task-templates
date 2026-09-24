import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import type { BatchRequest, Edge, EntitySnapshot, EntityTask, Id, UndoRecord } from './types';
import {
	buildEdgeRevert,
	buildRevert,
	buildUndoRecord,
	parseUndoJson,
	serializeUndo,
	UNDO_FILE_VERSION
} from './undo';

// Probe 096's shape. Template A (101): comp 1001, roto 1002, lay 1003; roto on comp.
// Template B (202): comp 2001, lay 2003, paint 2004, fx 2005; lay on comp start-to-start +1,
// paint on lay. Shot 7557 was made with A, then edited by hand.
const SHOT = { type: 'Shot', id: 7557, name: 'sh010' };
const A = { type: 'TaskTemplate', id: 101, name: 'A' };
const B_ID = 202;

type Opts = {
	link?: { id: Id; templateId: Id | null } | null;
	status?: string;
	fields?: Record<string, unknown>;
	start?: string | null;
	due?: string | null;
};

function task(id: Id, content: string, o: Opts = {}): EntityTask {
	return {
		id,
		content,
		step: null,
		key: matchKey(content, null),
		status: o.status ?? 'wtg',
		sortOrder: null,
		duration: null,
		estInMins: null,
		description: null,
		milestone: false,
		startDate: o.start ?? null,
		dueDate: o.due ?? null,
		assignees: [],
		reviewers: [],
		fields: o.fields ?? {},
		entity: SHOT,
		templateTask: o.link ?? null,
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-02T15:58:21Z'
	};
}

const edge = (
	id: Id,
	downstream: Id,
	upstream: Id,
	type: Edge['type'] = 'finish-to-start-next-day',
	offsetDays: number | null = null
): Edge & { id: Id } => ({ id, downstream, upstream, type, offsetDays });

const f = (desc: string | null, order: number | null, duration: number | null) => ({
	sg_description: desc,
	sg_sort_order: order,
	duration
});

// Before: comp, roto, lay from A; fx hand-made; old and notes are extras.
const before: EntitySnapshot = {
	entity: { ...SHOT, entityType: 'Shot', taskTemplate: A },
	tasks: [
		task(11, 'comp', { link: { id: 1001, templateId: 101 }, status: 'ip', fields: f('hand', 1, 480) }),
		task(12, 'roto', {
			link: { id: 1002, templateId: 101 },
			fields: f('hand', 2, 1440),
			start: '2026-03-02',
			due: '2026-03-04'
		}),
		task(13, 'lay', {
			link: { id: 1003, templateId: 101 },
			fields: f(null, 99, 960),
			start: '2026-03-02',
			due: '2026-03-03'
		}),
		task(14, 'old'),
		task(15, 'notes', { status: 'ip' }),
		task(17, 'fx', { fields: f('mine', 5, 60) })
	],
	edges: [
		edge(501, 12, 11), // roto on comp: A's edge, kept (one end not linked to B)
		edge(503, 14, 11), // old on comp: retired with old (089)
		edge(504, 11, 13, 'finish-to-finish', 1), // comp on lay: the reverse of B's, erased (101)
		edge(505, 15, 13), // notes on lay: removed by DELETE in the apply batch (095)
		edge(506, 17, 11, 'finish-to-finish', 0) // fx on comp: not in B, deleted, kept -> re-created
	],
	usage: {},
	readAt: '2026-09-24T10:00:00Z'
};

// After the apply batch: claims 11, 13, 17; omit 15; delete 14 and edge 505; B's fields
// overwrote comp and lay; paint 16 created; lay moved by the cascade; 506 re-created as 603.
const after = {
	tasks: [
		task(11, 'comp', { link: { id: 2001, templateId: B_ID }, status: 'ip', fields: f('B.comp', 10, 480) }),
		task(12, 'roto', {
			link: { id: 1002, templateId: 101 },
			fields: f('hand', 2, 1440),
			start: '2026-03-02',
			due: '2026-03-04'
		}),
		task(13, 'lay', {
			link: { id: 2003, templateId: B_ID },
			fields: f('B.lay', 20, 960),
			start: '2026-03-04',
			due: '2026-03-05'
		}),
		task(15, 'notes', { status: 'omt' }),
		task(16, 'paint', { link: { id: 2004, templateId: B_ID }, fields: f('B.paint', 30, 480) }),
		task(17, 'fx', { link: { id: 2005, templateId: B_ID }, fields: f('mine', 40, 60) })
	],
	edges: [
		edge(501, 12, 11),
		edge(601, 13, 11, 'start-to-start', 1), // B's lay on comp, in place of 504
		edge(602, 16, 13), // B's paint on lay
		edge(603, 17, 11, 'finish-to-finish', 0) // 506 re-created under keep
	]
};

const upd = (entity: string, record_id: Id, data: Record<string, unknown>): BatchRequest => ({
	request_type: 'update',
	entity,
	record_id,
	data
});
const del = (entity: string, record_id: Id): BatchRequest => ({ request_type: 'delete', entity, record_id });

const applyBatch: BatchRequest[] = [
	upd('Task', 11, { template_task: { type: 'Task', id: 2001 } }),
	upd('Task', 13, { template_task: { type: 'Task', id: 2003 } }),
	upd('Task', 17, { template_task: { type: 'Task', id: 2005 } }),
	upd('Task', 15, { sg_status_list: 'omt' }),
	del('Task', 14),
	del('TaskDependency', 505),
	upd('Shot', 7557, { task_template: null }),
	upd('Shot', 7557, { task_template: { type: 'TaskTemplate', id: B_ID } }),
	upd('Task', 17, { sg_description: 'mine' }),
	{
		request_type: 'create',
		entity: 'TaskDependency',
		data: {
			task: { type: 'Task', id: 17 },
			dependent_task: { type: 'Task', id: 11 },
			dependency_type: 'finish-to-finish',
			offset_days: 0
		}
	}
];

function record(over: Partial<Parameters<typeof buildUndoRecord>[0]> = {}): UndoRecord {
	return buildUndoRecord({
		runId: 'run-1',
		templateId: B_ID,
		appliedAt: '2026-09-24T10:01:00Z',
		before,
		after,
		batch: applyBatch,
		...over
	});
}

// A conflict loser (106): a second comp, linked to B's comp before, unlinked by the apply batch.
const loser = task(18, 'comp', { link: { id: 2001, templateId: B_ID }, fields: f('dup', 3, 60) });
const withLoser = {
	before: { ...before, tasks: [...before.tasks, loser] },
	after: { ...after, tasks: [...after.tasks, { ...loser, templateTask: null }] },
	batch: [upd('Task', 18, { template_task: null }), ...applyBatch]
};

// The deleted extra was linked to A (a task B lacks): revived before A's write, which re-syncs it.
const withDeletedA = {
	before: {
		...before,
		tasks: before.tasks.map((t) =>
			t.id === 14 ? task(14, 'old', { link: { id: 1004, templateId: 101 }, fields: f('old', 7, 120) }) : t
		)
	}
};

// 109: comp (11) depended on notes (15, an extra): erased by the apply, removed in the plan.
// lay (13) depended on 9901 on another Shot: erased by the apply, kept, re-created as 604.
const withOutside = {
	before: {
		...before,
		edges: [...before.edges, edge(507, 11, 15, 'start-to-start', 2), edge(508, 13, 9901, 'start-to-start', 0)]
	},
	after: { ...after, edges: [...after.edges, edge(604, 13, 9901, 'start-to-start', 0)] }
};

const createReq = (e: Edge): BatchRequest => ({
	request_type: 'create',
	entity: 'TaskDependency',
	data: {
		task: { type: 'Task', id: e.downstream },
		dependent_task: { type: 'Task', id: e.upstream },
		dependency_type: e.type,
		...(e.offsetDays === null ? {} : { offset_days: e.offsetDays })
	}
});

const fieldsOf = (rec: UndoRecord, taskId: Id) =>
	Object.fromEntries(rec.fieldValues.filter((v) => v.taskId === taskId).map((v) => [v.field, v.previous]));

describe('buildUndoRecord', () => {
	it('records the previous template_task of each claimed Task, null for a hand-made one', () => {
		expect(record().claimed).toEqual([
			{ taskId: 11, previousTemplateTask: 1001 },
			{ taskId: 13, previousTemplateTask: 1003 },
			{ taskId: 17, previousTemplateTask: null }
		]);
	});

	it("records the entity's previous task_template", () => {
		expect(record().previousTaskTemplate).toEqual(A);
		const fresh = { ...before, entity: { ...before.entity, taskTemplate: null } };
		expect(record({ before: fresh }).previousTaskTemplate).toBeNull();
	});

	it('records the previous status of omitted Tasks', () => {
		expect(record().omitted).toEqual([{ taskId: 15, previousStatus: 'ip' }]);
	});

	it('records deleted and created Task ids', () => {
		const rec = record();
		expect(rec.deletedTasks).toEqual([14]);
		expect(rec.created).toEqual([16]);
	});

	it('records every policy field of Tasks the old template re-syncs on undo (096: roto)', () => {
		const rec = record();
		expect(fieldsOf(rec, 11)).toEqual(f('hand', 1, 480));
		expect(fieldsOf(rec, 13)).toEqual({ sg_description: null, sg_sort_order: 99 }); // dated: duration kept (102)
		expect(fieldsOf(rec, 12)).toEqual({ sg_description: 'hand', sg_sort_order: 2 }); // untouched by B, reset by A
	});

	it('records only the fields the apply changed on a Task the old template does not hold', () => {
		expect(fieldsOf(record(), 17)).toEqual({ sg_sort_order: 5 });
	});

	it('records no fields for extras, deleted or created Tasks', () => {
		const ids = new Set(record().fieldValues.map((v) => v.taskId));
		expect([...ids].sort()).toEqual([11, 12, 13, 17]);
	});

	it('records only changed fields on kept Tasks when the entity was already on the template', () => {
		const onB = { ...before, entity: { ...before.entity, taskTemplate: { type: 'TaskTemplate', id: B_ID } } };
		const rec = record({ before: onB });
		expect(fieldsOf(rec, 12)).toEqual({});
		expect(fieldsOf(rec, 11)).toEqual({ sg_description: 'hand', sg_sort_order: 1 });
	});

	it('records edges removed by DELETE as revivable, with the full row', () => {
		expect(record().deletedEdges).toEqual([edge(505, 15, 13)]);
	});

	it('records edges the apply erased, and which of them it re-created', () => {
		const rec = record();
		expect(rec.droppedEdges).toEqual([edge(504, 11, 13, 'finish-to-finish', 1), edge(506, 17, 11, 'finish-to-finish', 0)]);
		expect(rec.recreatedEdges).toEqual([{ previousId: 506, id: 603 }]);
	});

	it('does not count edges retired with a deleted Task as dropped (089: revive brings them back)', () => {
		expect(record().droppedEdges.map((e) => e.id)).not.toContain(503);
	});

	it('records the edges the apply added, not the re-created ones', () => {
		expect(record().addedEdges.map((e) => e.id)).toEqual([601, 602]);
	});

	it('records every edge before the apply, for the edge revert', () => {
		expect(record().edgesBefore?.map((e) => e.id)).toEqual([501, 503, 504, 505, 506]);
	});

	it('records dates the cascade moved, which undo cannot restore (087, 095)', () => {
		expect(record().datesMoved).toEqual([
			{ taskId: 13, before: { start: '2026-03-02', due: '2026-03-03' }, after: { start: '2026-03-04', due: '2026-03-05' } }
		]);
	});

	it('records the Tasks the old template re-syncs on undo (096, 102)', () => {
		expect(record().resyncedOnUndo).toEqual([11, 12, 13]);
		const fresh = { ...before, entity: { ...before.entity, taskTemplate: null } };
		expect(record({ before: fresh }).resyncedOnUndo).toEqual([]);
	});

	it('records conflict losers unlinked by the apply apart from claims (106)', () => {
		const rec = record(withLoser);
		expect(rec.unlinked).toEqual([{ taskId: 18, previousTemplateTask: 2001 }]);
		expect(rec.claimed.map((c) => c.taskId)).not.toContain(18);
	});

	it('records the fields of a deleted Task linked to the old template: revived, then re-synced (096)', () => {
		const rec = record(withDeletedA);
		expect(rec.resyncedOnUndo).toContain(14);
		expect(fieldsOf(rec, 14)).toEqual({ sg_description: 'old', sg_sort_order: 7, duration: 120 });
	});

	it('records outside-upstream edges the apply erased (109), and the one it re-created', () => {
		const rec = record(withOutside);
		expect(rec.droppedEdges.map((e) => e.id)).toEqual([504, 506, 507, 508]);
		expect(rec.recreatedEdges).toEqual([
			{ previousId: 506, id: 603 },
			{ previousId: 508, id: 604 }
		]);
		expect(rec.addedEdges.map((e) => e.id)).toEqual([601, 602]);
	});

	it('stamps version, run, entity, template and time', () => {
		const rec = record();
		expect(rec).toMatchObject({
			version: 1,
			runId: 'run-1',
			entity: { type: 'Shot', id: 7557 },
			templateId: B_ID,
			appliedAt: '2026-09-24T10:01:00Z',
			clearedDates: []
		});
	});
});

describe('buildRevert', () => {
	it("writes old template_task first, then the old task_template, then deletes created Tasks (096)", () => {
		const { batch } = buildRevert(record(), after.edges);
		expect(batch.slice(0, 5)).toEqual([
			upd('Task', 11, { template_task: { type: 'Task', id: 1001 } }),
			upd('Task', 13, { template_task: { type: 'Task', id: 1003 } }),
			upd('Task', 17, { template_task: null }),
			upd('Shot', 7557, { task_template: { type: 'TaskTemplate', id: 101 } }),
			del('Task', 16)
		]);
	});

	it('writes the pre-merge fields back after the old template re-syncs them, then the statuses', () => {
		const { batch } = buildRevert(record(), after.edges);
		expect(batch.slice(5)).toEqual([
			upd('Task', 11, f('hand', 1, 480)),
			upd('Task', 12, { sg_description: 'hand', sg_sort_order: 2 }),
			upd('Task', 13, { sg_description: null, sg_sort_order: 99 }),
			upd('Task', 17, { sg_sort_order: 5 }),
			upd('Task', 15, { sg_status_list: 'ip' })
		]);
	});

	it('writes null when the entity had no template (096: null touches nothing)', () => {
		const fresh = { ...before, entity: { ...before.entity, taskTemplate: null } };
		const { batch } = buildRevert(record({ before: fresh }), after.edges);
		expect(batch).toContainEqual(upd('Shot', 7557, { task_template: null }));
	});

	it('leaves task_template alone when the entity was already on the template (084: a rewrite re-creates Tasks)', () => {
		const onB = { ...before, entity: { ...before.entity, taskTemplate: { type: 'TaskTemplate', id: B_ID } } };
		const { batch } = buildRevert(record({ before: onB }), after.edges);
		expect(batch.some((r) => r.entity === 'Shot')).toBe(false);
	});

	it('writes entity links back as type and id only', () => {
		const withStep = {
			...before,
			tasks: before.tasks.map((t) =>
				t.id === 11 ? { ...t, fields: { ...t.fields, step: { type: 'Step', id: 4, name: 'Comp' } } } : t
			)
		};
		const { batch } = buildRevert(record({ before: withStep }), after.edges);
		expect(batch).toContainEqual(upd('Task', 11, { ...f('hand', 1, 480), step: { type: 'Step', id: 4 } }));
	});

	it("writes a conflict loser's previous template_task back with the claims, before task_template (106, 096)", () => {
		const { batch } = buildRevert(record(withLoser), after.edges);
		expect(batch.slice(0, 5)).toEqual([
			upd('Task', 11, { template_task: { type: 'Task', id: 1001 } }),
			upd('Task', 13, { template_task: { type: 'Task', id: 1003 } }),
			upd('Task', 17, { template_task: null }),
			upd('Task', 18, { template_task: { type: 'Task', id: 2001 } }),
			upd('Shot', 7557, { task_template: { type: 'TaskTemplate', id: 101 } })
		]);
	});

	it('leaves out edges its own task_template write removes: a delete of one 404s the batch (104)', () => {
		// 601 (lay on comp): both ends go back to A's tasks. 602: paint retires it. 603: a kept edge.
		const { batch } = buildRevert(record(), after.edges);
		expect(batch.filter((r) => r.entity === 'TaskDependency')).toEqual([]);
	});

	it("deletes the apply's edges between old Tasks when the entity had no template (104: null removes nothing)", () => {
		const fresh = { ...before, entity: { ...before.entity, taskTemplate: null } };
		const { batch } = buildRevert(record({ before: fresh }), after.edges);
		expect(batch.slice(3, 6)).toEqual([
			upd('Shot', 7557, { task_template: null }),
			del('Task', 16),
			del('TaskDependency', 601)
		]);
	});

	it('deletes them too when there is no task_template write (entity already on the template)', () => {
		const onB = { ...before, entity: { ...before.entity, taskTemplate: { type: 'TaskTemplate', id: B_ID } } };
		const { batch } = buildRevert(record({ before: onB }), after.edges);
		expect(batch).toContainEqual(del('TaskDependency', 601));
	});

	it('deletes an added edge with no end on the old template; the write leaves it (102, 109)', () => {
		const rec = record();
		rec.addedEdges.push(edge(605, 17, 15));
		const { batch } = buildRevert(rec, [...after.edges, edge(605, 17, 15)]);
		expect(batch.filter((r) => r.entity === 'TaskDependency')).toEqual([del('TaskDependency', 605)]);
	});

	it('leaves an added edge with one end on the old template to the edge revert (mixed ends: not measured, 104)', () => {
		const rec = record();
		rec.addedEdges.push(edge(606, 17, 13));
		const live = [...after.edges, edge(606, 17, 13)];
		expect(buildRevert(rec, live).batch.filter((r) => r.entity === 'TaskDependency')).toEqual([]);
		expect(buildEdgeRevert(rec, live).remove).toContainEqual(del('TaskDependency', 606));
	});

	it('deletes only added edges read live before the batch: a gone one would 404 (104)', () => {
		const fresh = { ...before, entity: { ...before.entity, taskTemplate: null } };
		const live = after.edges.filter((e) => e.id !== 601);
		expect(buildRevert(record({ before: fresh }), live).batch.some((r) => r.entity === 'TaskDependency')).toBe(false);
	});

	it('never deletes an edge the apply re-created under keep: it stands for the old row (109)', () => {
		const fresh = { ...before, entity: { ...before.entity, taskTemplate: null } };
		const rec = record({ ...withOutside, before: { ...withOutside.before, entity: fresh.entity } });
		const { batch } = buildRevert(rec, withOutside.after.edges);
		expect(batch).not.toContainEqual(del('TaskDependency', 603));
		expect(batch).not.toContainEqual(del('TaskDependency', 604));
	});

	it('revives deleted Tasks one call each, before the batch (103: a batch delete retires; 096)', () => {
		expect(buildRevert(record(), after.edges).reviveTasks).toEqual([14]);
	});

	it('notes what undo cannot restore', () => {
		const { notes } = buildRevert(record(), after.edges);
		expect(notes).toContainEqual({
			code: 'dates_moved',
			taskId: 13,
			before: { start: '2026-03-02', due: '2026-03-03' },
			after: { start: '2026-03-04', due: '2026-03-05' }
		});
		expect(notes).toContainEqual({ code: 'edges_recreated', edgeIds: [504, 506] });
		expect(notes).toContainEqual({ code: 'history_kept' });
	});

	it('is empty for a record with nothing to undo', () => {
		const onB = { ...before, entity: { ...before.entity, taskTemplate: { type: 'TaskTemplate', id: B_ID } } };
		const rec = buildUndoRecord({
			runId: 'r',
			templateId: B_ID,
			appliedAt: 'x',
			before: onB,
			after: { tasks: onB.tasks, edges: onB.edges },
			batch: []
		});
		expect(buildRevert(rec, onB.edges).batch).toEqual([]);
		expect(buildRevert(rec, onB.edges).reviveTasks).toEqual([]);
	});
});

const downOf = (r: BatchRequest) =>
	r.request_type === 'create' ? (r.data.task as { id: Id }).id : null;

describe('buildEdgeRevert', () => {
	// Live edges read after the revert batch and the Task revives. A's re-sync deleted B's lay on
	// comp (601), paint's edge retired with paint (602), old's edge came back with old (503),
	// and A's re-sync added 701, an edge of A the Shot lacked before.
	const live = [edge(501, 12, 11), edge(503, 14, 11), edge(603, 17, 11, 'finish-to-finish', 0), edge(701, 13, 12)];

	it('revives edges removed by DELETE, never re-creates them (095)', () => {
		const r = buildEdgeRevert(record(), live);
		expect(r.revive).toEqual([505]);
		expect(r.create.map((c) => downOf(c))).not.toContain(15);
	});

	it('re-creates erased edges from type, offset and both Task ids (101)', () => {
		expect(buildEdgeRevert(record(), live).create).toEqual([
			{
				request_type: 'create',
				entity: 'TaskDependency',
				data: {
					task: { type: 'Task', id: 11 },
					dependent_task: { type: 'Task', id: 13 },
					dependency_type: 'finish-to-finish',
					offset_days: 1
				}
			}
		]);
	});

	it('keeps an edge re-created under keep when it matches the old row', () => {
		const r = buildEdgeRevert(record(), live);
		expect(r.remove).not.toContainEqual(del('TaskDependency', 603));
		expect(r.create).toHaveLength(1);
	});

	it('removes added edges still live, first, so the pair is free (085)', () => {
		const noResync = [...live, edge(601, 13, 11, 'start-to-start', 1)];
		const r = buildEdgeRevert(record(), noResync);
		expect(r.remove).toEqual([del('TaskDependency', 601)]);
	});

	it('removes whatever holds the pair of an edge to revive (095: revive after re-create is 400)', () => {
		const r = buildEdgeRevert(record(), [...live, edge(801, 13, 15)]);
		expect(r.remove).toContainEqual(del('TaskDependency', 801));
		expect(r.revive).toEqual([505]);
	});

	it('omits offset_days when the old row had none (086)', () => {
		const rec = record();
		rec.droppedEdges = [edge(504, 11, 13, 'start-to-start', null)];
		rec.edgesBefore = rec.edgesBefore!.map((e) => (e.id === 504 ? edge(504, 11, 13, 'start-to-start', null) : e));
		expect(buildEdgeRevert(rec, live).create[0]).toEqual({
			request_type: 'create',
			entity: 'TaskDependency',
			data: { task: { type: 'Task', id: 11 }, dependent_task: { type: 'Task', id: 13 }, dependency_type: 'start-to-start' }
		});
	});

	it('leaves unknown live edges in place and lists them', () => {
		expect(buildEdgeRevert(record(), live).left).toEqual([edge(701, 13, 12)]);
	});

	it('restores an edge the old template re-sync erased (a hand-made edge between its Tasks)', () => {
		const r = buildEdgeRevert(record(), live.filter((e) => e.id !== 501));
		expect(r.create.map((c) => downOf(c))).toContain(12);
	});

	it('re-creates an outside-upstream edge the apply erased and the plan removed (109: not revivable)', () => {
		const r = buildEdgeRevert(record(withOutside), [...live, edge(604, 13, 9901, 'start-to-start', 0)]);
		expect(r.revive).toEqual([505]);
		expect(r.create).toContainEqual(createReq(edge(507, 11, 15, 'start-to-start', 2)));
		expect(r.remove).not.toContainEqual(del('TaskDependency', 604));
		expect(r.create.map((c) => (c.request_type === 'create' ? c.data.dependent_task : null))).not.toContainEqual({
			type: 'Task',
			id: 9901
		});
	});

	it("re-creates a kept outside-upstream edge the old template's write erased again on undo (109)", () => {
		// lay (13) is back on A when A's write runs: its edge from the other Shot's Task is erased.
		const r = buildEdgeRevert(record(withOutside), live);
		expect(r.create).toContainEqual(createReq(edge(508, 13, 9901, 'start-to-start', 0)));
		expect(r.remove).toEqual([]);
	});

	it("re-creates a pre-merge outside-upstream edge the old template's write erases on undo (109)", () => {
		const rec = record({ ...withOutside, before: { ...withOutside.before, edges: [...withOutside.before.edges, edge(509, 12, 15)] } });
		rec.edgesBefore = [...rec.edgesBefore!];
		const r = buildEdgeRevert(rec, live);
		expect(r.create).toContainEqual(createReq(edge(509, 12, 15)));
	});

	it('does nothing when the live edges are the edges before', () => {
		const r = buildEdgeRevert(record(), before.edges);
		expect(r).toEqual({ remove: [], revive: [], create: [], left: [] });
	});
});

describe('serializeUndo / parseUndoJson', () => {
	it('round-trips a run of records', () => {
		const recs = [record(), record({ runId: 'run-1', before: { ...before, entity: { ...before.entity, id: 7558 } } })];
		const text = serializeUndo(recs);
		expect(JSON.parse(text).version).toBe(UNDO_FILE_VERSION);
		expect(parseUndoJson(text)).toEqual(recs);
	});

	it('rejects an unknown file version', () => {
		expect(() => parseUndoJson(JSON.stringify({ version: 99, records: [] }))).toThrow(/version/);
	});

	it('rejects an unknown record version', () => {
		const text = JSON.stringify({ version: UNDO_FILE_VERSION, records: [{ ...record(), version: 2 }] });
		expect(() => parseUndoJson(text)).toThrow(/version/);
	});

	it('rejects text that is not an undo file', () => {
		expect(() => parseUndoJson('not json')).toThrow();
		expect(() => parseUndoJson('[]')).toThrow();
		expect(() => parseUndoJson(JSON.stringify({ version: 1, records: [{ version: 1 }] }))).toThrow();
	});
});
