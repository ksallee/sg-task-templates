import { describe, expect, it } from 'vitest';
import type { EntityRow } from 'sg-widgets-core';
import { diffEntity, failedEntityResult, pairResults, resultForEntity } from './result';
import { edgeFromRow, taskFromRow, templateFromRows, templateTaskFromRow } from './read';
import type {
	AffectedEdge,
	BatchRequest,
	BatchResultRow,
	ClaimRow,
	CreateRow,
	EntityPlan,
	EntityRef,
	EntitySnapshot,
	ExtraRow,
	FieldChange,
	KeepRow
} from './types';
import templates from './fixtures/recipe015-templates.json';
import shotBefore from './fixtures/recipe015-shot-before.json';
import shotAfter from './fixtures/recipe015-shot-after.json';

const tt1Ids = new Set([47101, 47102]);
const tt2Ids = new Set([47201, 47202, 47203]);
const templateOf = (id: number) => (tt1Ids.has(id) ? 201 : tt2Ids.has(id) ? 202 : null);

/** The shot-snapshot fixture shape (fixtures.md), typed loosely: each fixture's JSON import infers
 * its own literal types, which do not otherwise unify across files or across a `structuredClone`. */
interface ShotFixture {
	shot: EntityRow;
	tasks: EntityRow[];
	dependencies: EntityRow[];
}

function asFixture(shot: unknown): ShotFixture {
	return shot as ShotFixture;
}

function snapshot(shotJson: unknown): EntitySnapshot {
	const shot = asFixture(shotJson);
	return {
		entity: {
			type: shot.shot.type,
			id: shot.shot.id,
			name: shot.shot.attributes.code as string,
			entityType: shot.shot.type,
			taskTemplate: shot.shot.relationships.task_template.data as EntityRef | null
		},
		tasks: shot.tasks.map((r) => taskFromRow(r, templateOf)),
		edges: shot.dependencies.map(edgeFromRow),
		usage: {},
		readAt: '2026-09-02T16:10:00Z'
	};
}

function tt2() {
	return templateFromRows(
		templates.templates[1] as EntityRow,
		templates.templateTasks.filter((t) => t.relationships.task_template.data?.id === 202) as EntityRow[],
		templates.templateDependencies as EntityRow[]
	);
}

/** The plan `recipe015-shot-before.json` + tt2 yields (fixtures.md, "Expected plan"). */
function recipe015Plan(): EntityPlan {
	const before = snapshot(shotBefore);
	const tpl = tt2();
	const byId = (id: number) => tpl.tasks.find((t) => t.id === id)!;
	const t295 = before.tasks.find((t) => t.id === 47295)!;
	const t296 = before.tasks.find((t) => t.id === 47296)!;
	const t297 = before.tasks.find((t) => t.id === 47297)!;

	const claim296: ClaimRow = {
		kind: 'claim',
		task: t296,
		templateTask: byId(47201),
		previousTemplateTask: t296.templateTask,
		fieldChanges: [],
		rename: null
	};
	const claim297: ClaimRow = {
		kind: 'claim',
		task: t297,
		templateTask: byId(47203),
		previousTemplateTask: t297.templateTask,
		fieldChanges: [],
		rename: null
	};
	const create202: CreateRow = {
		kind: 'create',
		templateTask: byId(47202),
		templateDates: { start: null, due: null },
		datesClearable: true
	};
	const extra295: ExtraRow = {
		kind: 'extra',
		task: t295,
		action: 'leave',
		usage: { versions: 0, publishedFiles: 0 },
		reason: 'not_in_template'
	};

	return {
		entity: before.entity,
		templateId: 202,
		rows: [claim296, claim297, create202, extra295],
		edges: {
			expectedAdded: [
				{
					templateEdge: tpl.edges[0], // paint (47203) dependent on comp (47201), SS +1
					downstream: { existing: 47297 },
					upstream: { existing: 47296 }
				}
			],
			affected: [],
			toExtras: [],
			mayMove: [],
			wouldViolate: []
		},
		counts: { keep: 0, claim: 2, create: 1, extra: 1, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false
	};
}

describe('diffEntity: recipe 015, everything landed', () => {
	it('matches the read-back to the plan with no differences', () => {
		const plan = recipe015Plan();
		const before = snapshot(shotBefore);
		const after = snapshot(shotAfter);
		const result = diffEntity(plan, before, after);
		expect(result.created).toEqual([47298]);
		expect(result.createdFor).toEqual([{ templateTaskId: 47202, taskId: 47298 }]);
		expect(result.addedEdges).toEqual([{ id: 9101, downstream: 47297, upstream: 47296, type: 'start-to-start', offsetDays: 1 }]);
		expect(result.differences).toEqual([]);
	});

	it('wraps a clean diff as an ok EntityResult', () => {
		const plan = recipe015Plan();
		const result = resultForEntity(plan, snapshot(shotBefore), snapshot(shotAfter));
		expect(result.kind).toBe('ok');
		if (result.kind === 'ok') expect(result.differences).toEqual([]);
	});
});

describe('diffEntity: creates', () => {
	it('flags a predicted create that did not happen', () => {
		const plan = recipe015Plan();
		const before = snapshot(shotBefore);
		const after = snapshot(shotAfter);
		after.tasks = after.tasks.filter((t) => t.id !== 47298);
		const result = diffEntity(plan, before, after);
		expect(result.created).toEqual([]);
		expect(result.differences).toContainEqual({ code: 'create_missing', templateTaskId: 47202 });
	});

	it('flags a new Task under a template task no create row named', () => {
		const plan = recipe015Plan();
		const before = snapshot(shotBefore);
		const after = snapshot(shotAfter);
		after.tasks = [
			...after.tasks,
			{ ...after.tasks[after.tasks.length - 1], id: 47299, templateTask: { id: 99999, templateId: 202 } }
		];
		const result = diffEntity(plan, before, after);
		expect(result.differences).toContainEqual({ code: 'create_unexpected', taskId: 47299, templateTaskId: 99999 });
	});
});

describe('diffEntity: claims', () => {
	it('flags a claim whose link did not land', () => {
		const plan = recipe015Plan();
		const before = snapshot(shotBefore);
		const brokenAfter = asFixture(structuredClone(shotAfter));
		brokenAfter.tasks.find((t) => t.id === 47297)!.relationships.template_task.data = null;
		const after = snapshot(brokenAfter);
		const result = diffEntity(plan, before, after);
		expect(result.differences).toContainEqual({ code: 'claim_missing', taskId: 47297, templateTaskId: 47203 });
	});
});

describe('diffEntity: write-backs', () => {
	const templateRow: EntityRow = {
		type: 'Task',
		id: 501,
		attributes: { content: 'Layout', duration: 1440, sg_sort_order: 10 },
		relationships: { task_template: { data: { id: 900, name: 'T', type: 'TaskTemplate' } } }
	};
	const beforeRow: EntityRow = {
		type: 'Task',
		id: 601,
		attributes: { content: 'Layout', duration: 960, sg_sort_order: 10 },
		relationships: {
			entity: { data: { id: 1, name: 'sh', type: 'Shot' } },
			template_task: { data: { id: 500, name: 'Layout', type: 'Task' } }
		}
	};

	function plan(): EntityPlan {
		const templateTask = templateTaskFromRow(templateRow);
		const task = taskFromRow(beforeRow, () => 900);
		const change: FieldChange = { field: 'duration', current: 960, template: 1440, policy: 'overwrite', result: 1440 };
		const keep: KeepRow = { kind: 'keep', task, templateTask, keyMismatch: false, fieldChanges: [change], rename: null };
		return {
			entity: { type: 'Shot', id: 1, name: 'sh', entityType: 'Shot', taskTemplate: null },
			templateId: 900,
			rows: [keep],
			edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
			counts: { keep: 1, claim: 0, create: 0, extra: 0, conflict: 0 },
			warnings: [],
			needsClearFirst: false,
			noop: false
		};
	}

	it('holds no difference when the write-back landed', () => {
		const before = { tasks: [taskFromRow(beforeRow, () => 900)], edges: [] } as unknown as EntitySnapshot;
		const afterRow = { ...beforeRow, attributes: { ...beforeRow.attributes, duration: 1440 } };
		const after = { tasks: [taskFromRow(afterRow, () => 900)], edges: [] } as unknown as EntitySnapshot;
		expect(diffEntity(plan(), before, after).differences).toEqual([]);
	});

	it('flags a field write-back that did not hold', () => {
		const before = { tasks: [taskFromRow(beforeRow, () => 900)], edges: [] } as unknown as EntitySnapshot;
		const after = { tasks: [taskFromRow(beforeRow, () => 900)], edges: [] } as unknown as EntitySnapshot; // unchanged: 960
		expect(diffEntity(plan(), before, after).differences).toContainEqual({
			code: 'writeback_missing',
			taskId: 601,
			field: 'duration',
			expected: 1440,
			actual: 960
		});
	});
});

describe('diffEntity: deletes', () => {
	const row: EntityRow = {
		type: 'Task',
		id: 603,
		attributes: { content: 'Matchmove' },
		relationships: { entity: { data: { id: 1, name: 'sh', type: 'Shot' } } }
	};

	function planWithDelete(): EntityPlan {
		const extra: ExtraRow = {
			kind: 'extra',
			task: taskFromRow(row, () => null),
			action: 'delete',
			usage: { versions: 0, publishedFiles: 0 },
			reason: 'not_in_template'
		};
		return {
			entity: { type: 'Shot', id: 1, name: 'sh', entityType: 'Shot', taskTemplate: null },
			templateId: 1,
			rows: [extra],
			edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
			counts: { keep: 0, claim: 0, create: 0, extra: 1, conflict: 0 },
			warnings: [],
			needsClearFirst: false,
			noop: false
		};
	}

	it('is satisfied when the deleted Task is gone from the read-back', () => {
		const before = { tasks: [taskFromRow(row, () => null)], edges: [] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [] } as unknown as EntitySnapshot;
		expect(diffEntity(planWithDelete(), before, after).differences).toEqual([]);
	});

	it('flags a delete that did not take', () => {
		const before = { tasks: [taskFromRow(row, () => null)], edges: [] } as unknown as EntitySnapshot;
		const after = { tasks: [taskFromRow(row, () => null)], edges: [] } as unknown as EntitySnapshot;
		expect(diffEntity(planWithDelete(), before, after).differences).toContainEqual({ code: 'delete_missing', taskId: 603 });
	});
});

describe('diffEntity: expected edges', () => {
	it('flags an expected edge that never appeared', () => {
		const plan = recipe015Plan();
		const before = snapshot(shotBefore);
		const noEdgeAfter = asFixture(structuredClone(shotAfter));
		noEdgeAfter.dependencies = [];
		const after = snapshot(noEdgeAfter);
		const result = diffEntity(plan, before, after);
		expect(result.addedEdges).toEqual([]);
		expect(result.differences).toContainEqual({ code: 'edge_expected_missing', downstream: 47297, upstream: 47296 });
	});
});

describe('diffEntity: affected edges (stale, not in the template)', () => {
	const existing = { id: 701, downstream: 602, upstream: 601, type: 'finish-to-start-next-day' as const, offsetDays: null };

	function planWithAffected(action: 'keep' | 'remove'): EntityPlan {
		const affected: AffectedEdge = { existing, cause: 'not_in_template', replacedBy: null, action };
		return {
			entity: { type: 'Shot', id: 1, name: 'sh', entityType: 'Shot', taskTemplate: null },
			templateId: 1,
			rows: [],
			edges: { expectedAdded: [], affected: [affected], toExtras: [], mayMove: [], wouldViolate: [] },
			counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
			warnings: [],
			needsClearFirst: false,
			noop: false
		};
	}

	it('flags a "keep" edge that was not re-created', () => {
		const before = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [] } as unknown as EntitySnapshot;
		expect(diffEntity(planWithAffected('keep'), before, after).differences).toContainEqual({
			code: 'edge_recreate_missing',
			previousId: 701,
			downstream: 602,
			upstream: 601
		});
	});

	it('is satisfied when a "keep" edge comes back under a new id', () => {
		const before = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [{ id: 799, downstream: 602, upstream: 601, type: 'finish-to-start-next-day', offsetDays: null }] } as unknown as EntitySnapshot;
		expect(diffEntity(planWithAffected('keep'), before, after).differences).toEqual([]);
	});

	it('flags a "remove" edge still present after apply', () => {
		const before = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [{ id: 799, downstream: 602, upstream: 601, type: 'finish-to-start-next-day', offsetDays: null }] } as unknown as EntitySnapshot;
		expect(diffEntity(planWithAffected('remove'), before, after).differences).toContainEqual({
			code: 'edge_still_present',
			edgeId: 799
		});
	});

	it('is satisfied when a "remove" edge is gone', () => {
		const before = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [] } as unknown as EntitySnapshot;
		expect(diffEntity(planWithAffected('remove'), before, after).differences).toEqual([]);
	});
});

describe('diffEntity: an edge on a deleted Task (103)', () => {
	const existing = { id: 702, downstream: 602, upstream: 609, type: 'finish-to-start-next-day' as const, offsetDays: null };
	const plan = (): EntityPlan => ({
		entity: { type: 'Shot', id: 1, name: 'sh', entityType: 'Shot', taskTemplate: null },
		templateId: 1,
		rows: [],
		edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [], withDeleted: [{ edge: existing, task: 609 }] },
		counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false
	});

	it('gone with its Task: no difference', () => {
		const before = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [] } as unknown as EntitySnapshot;
		expect(diffEntity(plan(), before, after).differences).toEqual([]);
	});

	it('still there: flagged', () => {
		const before = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		const after = { tasks: [], edges: [existing] } as unknown as EntitySnapshot;
		expect(diffEntity(plan(), before, after).differences).toEqual([{ code: 'edge_still_present', edgeId: 702 }]);
	});
});

describe('diffEntity: affected edges, matched on type and offset (105)', () => {
	const existing = { id: 701, downstream: 602, upstream: 601, type: 'finish-to-finish' as const, offsetDays: 5 };
	const templateEdge = { id: null, downstream: 602, upstream: 601, type: 'start-to-start' as const, offsetDays: 2 };

	function plan(cause: 'not_in_template' | 'replaced', action: 'keep' | 'remove'): EntityPlan {
		const affected: AffectedEdge = { existing, cause, replacedBy: cause === 'replaced' ? templateEdge : null, action };
		return {
			entity: { type: 'Shot', id: 1, name: 'sh', entityType: 'Shot', taskTemplate: null },
			templateId: 1,
			rows: [],
			edges: { expectedAdded: [], affected: [affected], toExtras: [], mayMove: [], wouldViolate: [] },
			counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
			warnings: [],
			needsClearFirst: false,
			noop: false
		};
	}
	const snap = (edges: unknown[]) => ({ tasks: [], edges }) as unknown as EntitySnapshot;
	// 102: c1 on b1 finish-to-finish 5 deleted, a new start-to-start 2 made in its place.
	const afterApply = { id: 800, downstream: 602, upstream: 601, type: 'start-to-start', offsetDays: 2 };
	const recreated = { ...existing, id: 801 };

	it('flags a kept edge whose pair holds only an edge of another type', () => {
		expect(diffEntity(plan('not_in_template', 'keep'), snap([existing]), snap([afterApply])).differences).toContainEqual({
			code: 'edge_recreate_missing',
			previousId: 701,
			downstream: 602,
			upstream: 601
		});
	});

	it('flags a kept edge re-created with offset null where it had 0 (105: they differ)', () => {
		const zero = { ...existing, offsetDays: 0 };
		const p = plan('not_in_template', 'keep');
		p.edges.affected[0].existing = zero;
		expect(diffEntity(p, snap([zero]), snap([{ ...zero, id: 801, offsetDays: null }])).differences).toHaveLength(1);
	});

	it('flags a replaced edge under keep that was not re-created', () => {
		expect(diffEntity(plan('replaced', 'keep'), snap([existing]), snap([afterApply])).differences).toContainEqual({
			code: 'edge_recreate_missing',
			previousId: 701,
			downstream: 602,
			upstream: 601
		});
	});

	it('is satisfied when a replaced edge under keep is back next to the template edge', () => {
		expect(diffEntity(plan('replaced', 'keep'), snap([existing]), snap([afterApply, recreated])).differences).toEqual([]);
	});

	it('flags a replaced edge under remove still present', () => {
		expect(diffEntity(plan('replaced', 'remove'), snap([existing]), snap([afterApply, recreated])).differences).toContainEqual({
			code: 'edge_still_present',
			edgeId: 801
		});
	});

	it('is satisfied when a replaced edge under remove left only the template edge', () => {
		expect(diffEntity(plan('replaced', 'remove'), snap([existing]), snap([afterApply])).differences).toEqual([]);
	});
});

describe('diffEntity: conflict losers (106)', () => {
	// 106: two Tasks linked to one template task; the batch unlinks the loser before the write.
	const loserRow = (templateTask: EntityRef | null): EntityRow => ({
		type: 'Task',
		id: 605,
		attributes: { content: 'x' },
		relationships: {
			entity: { data: { id: 1, name: 'sh', type: 'Shot' } },
			template_task: { data: templateTask }
		}
	});
	const linked = { id: 500, name: 'x', type: 'Task' };

	function planWithLoser(): EntityPlan {
		const extra: ExtraRow = {
			kind: 'extra',
			task: taskFromRow(loserRow(linked), () => 900),
			action: 'leave',
			usage: { versions: 0, publishedFiles: 0 },
			reason: 'conflict_loser'
		};
		return {
			entity: { type: 'Shot', id: 1, name: 'sh', entityType: 'Shot', taskTemplate: null },
			templateId: 900,
			rows: [extra],
			edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
			counts: { keep: 0, claim: 0, create: 0, extra: 1, conflict: 0 },
			warnings: [],
			needsClearFirst: false,
			noop: false
		};
	}
	const snap = (row: EntityRow) => ({ tasks: [taskFromRow(row, () => 900)], edges: [] }) as unknown as EntitySnapshot;

	it('flags a loser still linked to the template', () => {
		expect(diffEntity(planWithLoser(), snap(loserRow(linked)), snap(loserRow(linked))).differences).toContainEqual({
			code: 'unlink_missing',
			taskId: 605,
			templateTaskId: 500
		});
	});

	it('is satisfied when the loser reads template_task null', () => {
		expect(diffEntity(planWithLoser(), snap(loserRow(linked)), snap(loserRow(null))).differences).toEqual([]);
	});
});

describe('pairResults', () => {
	const reqs: BatchRequest[] = [
		{ request_type: 'create', entity: 'Task', data: {} },
		{ request_type: 'update', entity: 'Task', record_id: 47296, data: {} },
		{ request_type: 'delete', entity: 'Task', record_id: 47295 }
	];
	const rows: BatchResultRow[] = [
		{ data: { type: 'Task', id: 47298, attributes: {}, relationships: {} } },
		{ data: { type: 'Task', id: 47296, attributes: {}, relationships: {} }, links: {}, status: {} },
		{ request_type: 'delete', type: 'Task', id: 47295, uuid: 'x', did_delete: true }
	];

	it('pairs rows by position', () => {
		const paired = pairResults(reqs, rows);
		expect(paired.map((p) => p.id)).toEqual([47298, 47296, 47295]);
		expect(paired[0].req).toBe(reqs[0]);
	});

	it('reads the id of a flat delete row', () => {
		expect(pairResults(reqs, rows)[2]).toEqual({ req: reqs[2], id: 47295 });
	});

	it('throws when the rows are not one per request (recipe 002)', () => {
		expect(() => pairResults(reqs, rows.slice(0, 2))).toThrow('Flow PT answered 2 results for 3 writes.');
	});
});

describe('failedEntityResult', () => {
	it('becomes a failure entry with the client error title, verbatim', () => {
		// 107: a batch closing a loop answers 400 with this title and rolls back.
		const title = "Create failed for [TaskDependency]: Can't create this dependency as it causes a loop.";
		const entity = { type: 'Shot', id: 7557, name: 'sh010' };
		expect(failedEntityResult(entity, { status: 400, message: title })).toEqual({
			kind: 'failed',
			entity,
			error: { status: 400, message: title }
		});
	});
});
