import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import {
	describeDifference,
	describeNote,
	groupRows,
	mergeNotes,
	nameBook,
	resultRows,
	undoFileName,
	undoPreviewNotes,
	type ResultKind,
	type ResultRow
} from './result-view';
import type { EntityPlan, EntityRef, EntityTask, Run, TemplateTask, UndoRecord } from './types';

const shot = (id: number): EntityRef => ({ type: 'Shot', id, name: `sh${id}` });

function core(id: number, content: string) {
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
		startDate: null,
		dueDate: null,
		assignees: [],
		reviewers: [],
		fields: { content }
	};
}
const tt = (id: number, content: string): TemplateTask => ({ ...core(id, content), templateId: 5 });
const task = (id: number, content: string): EntityTask => ({
	...core(id, content),
	entity: shot(1),
	templateTask: null,
	pinned: false,
	dependencyViolation: false,
	createdAt: '2026-09-01T00:00:00Z'
});

const plan: EntityPlan = {
	entity: { ...shot(1), entityType: 'Shot', taskTemplate: null },
	templateId: 5,
	rows: [
		{ kind: 'claim', task: task(10, 'comp'), templateTask: tt(500, 'Comp'), previousTemplateTask: null, fieldChanges: [], rename: null },
		{ kind: 'create', templateTask: tt(501, 'Grade'), templateDates: { start: null, due: null }, datesClearable: false }
	],
	edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
	counts: { keep: 0, claim: 1, create: 1, extra: 0, conflict: 0 },
	warnings: [],
	needsClearFirst: false,
	noop: false
};

function record(entity: EntityRef, extra: Partial<UndoRecord> = {}): UndoRecord {
	return {
		version: 1,
		runId: 'run-1',
		entity,
		templateId: 5,
		appliedAt: '2026-09-24T10:00:00Z',
		previousTaskTemplate: { type: 'TaskTemplate', id: 4 },
		claimed: [],
		unlinked: [],
		resyncedOnUndo: [],
		linkedBefore: [],
		created: [],
		fieldValues: [],
		omitted: [],
		deletedTasks: [],
		droppedEdges: [],
		recreatedEdges: [],
		deletedEdges: [],
		addedEdges: [],
		clearedDates: [],
		edgesBefore: [],
		datesMoved: [],
		...extra
	};
}

const run = (entities: Run['entities']): Run => ({
	version: 1,
	id: 'run-1',
	project: { type: 'Project', id: 1 },
	template: { id: 5, code: 'T' },
	entryPoint: 'template_first',
	user: { type: 'HumanUser', id: 9 },
	options: {
		fieldPolicies: {},
		extraByName: {},
		extraOverrides: {},
		omitStatus: 'omt',
		conflictPicks: {},
		edgeActions: {},
		clearCreatedDates: false,
		deleteConfirmed: false
	},
	startedAt: '2026-09-24T10:00:00Z',
	finishedAt: null,
	entities
});

describe('nameBook', () => {
	it('names Tasks and template tasks from the plans, anything else by id', () => {
		const names = nameBook([plan]);
		expect(names.task(10)).toBe('comp');
		expect(names.task(7)).toBe('Task 7');
		expect(names.templateTask(500)).toBe('Comp');
		expect(names.templateTask(8)).toBe('template task 8');
	});
});

describe('describeDifference', () => {
	const names = nameBook([plan]);
	it('reads each difference as a sentence', () => {
		expect(describeDifference({ code: 'create_missing', templateTaskId: 501 }, names)).toBe('Grade was not created.');
		expect(describeDifference({ code: 'create_unexpected', taskId: 42, templateTaskId: 500 }, names)).toBe(
			'Task 42 was created for Comp, which the plan did not create.'
		);
		expect(describeDifference({ code: 'claim_missing', taskId: 10, templateTaskId: 500 }, names)).toBe('comp is not linked to Comp.');
		expect(
			describeDifference({ code: 'writeback_missing', taskId: 10, field: 'sg_description', expected: 'a', actual: null }, names)
		).toBe('comp: sg_description is null, expected "a".');
		expect(describeDifference({ code: 'delete_missing', taskId: 10 }, names)).toBe('comp was not deleted.');
		expect(describeDifference({ code: 'unlink_missing', taskId: 10, templateTaskId: 500 }, names)).toBe('comp is still linked to Comp.');
		expect(describeDifference({ code: 'edge_expected_missing', downstream: 10, upstream: 99 }, names)).toBe(
			'The dependency comp on Task 99 was not added.'
		);
		expect(describeDifference({ code: 'edge_recreate_missing', previousId: 3, downstream: 10, upstream: 99 }, names)).toBe(
			'The kept dependency comp on Task 99 was not re-created.'
		);
		expect(describeDifference({ code: 'edge_still_present', edgeId: 3 }, names)).toBe('Dependency 3 is still there.');
	});
});

describe('describeNote', () => {
	const names = nameBook([plan]);
	it('reads each undo note honestly', () => {
		expect(describeNote({ code: 'edges_recreated', edgeIds: [3, 4] }, names)).toBe(
			'2 dependencies come back as new rows: same ends, type and offset, new ids.'
		);
		expect(describeNote({ code: 'dates_may_move', taskIds: [10] }, names)).toBe(
			'Dates may move on comp: unpinned Tasks downstream of a revived or re-created dependency reschedule.'
		);
		expect(
			describeNote({ code: 'dates_moved', taskId: 10, before: { start: '2026-11-01', due: '2026-11-02' }, after: { start: '2026-11-03', due: null } }, names)
		).toBe('comp: the apply moved its dates (2026-11-01 to 2026-11-02, now 2026-11-03 to none). Undo does not write them back: that would pin it.');
		expect(describeNote({ code: 'linked_twice_unmeasured', templateTask: 500, taskIds: [10, 11] }, names)).toBe(
			'comp and Task 11 were both linked to Comp: which one the old template wires is the server\'s pick, not measured.'
		);
		expect(describeNote({ code: 'history_kept' }, names)).toBe('The event log keeps the apply and the undo.');
		expect(
			describeNote({ code: 'dates_moved', taskId: 10, before: { start: null, due: null }, after: { start: '2026-11-03', due: '2026-11-04' } }, names)
		).toBe('comp: the apply filled its dates from the template (now 2026-11-03 to 2026-11-04). Undo does not clear them: a null start date pins a Task with an upstream dependency.');
		expect(describeNote({ code: 'violation_may_change', taskIds: [10, 11] }, names)).toBe(
			'The dependency violation flag may differ from before on comp and Task 11: pinned Tasks keep their dates while what they depend on changed.'
		);
	});
});

describe('undoPreviewNotes', () => {
	it('warns before the undo: moved dates, erased edges that come back new, their downstream dates, twice-linked Tasks', () => {
		const e = (id: number, down: number, up: number) => ({ id, downstream: down, upstream: up, type: 'start-to-start' as const, offsetDays: null });
		const rec = record(shot(1), {
			claimed: [
				{ taskId: 10, previousTemplateTask: 400 },
				{ taskId: 11, previousTemplateTask: 400 }
			],
			edgesBefore: [e(1, 10, 20), e(2, 11, 21)],
			droppedEdges: [e(1, 10, 20)],
			deletedEdges: [e(3, 12, 20)],
			datesMoved: [{ taskId: 10, before: { start: 'a', due: 'b' }, after: { start: 'c', due: 'd' } }]
		});
		expect(undoPreviewNotes([rec])).toEqual([
			{ code: 'dates_moved', taskId: 10, before: { start: 'a', due: 'b' }, after: { start: 'c', due: 'd' } },
			{ code: 'linked_twice_unmeasured', templateTask: 400, taskIds: [10, 11] },
			{ code: 'edges_recreated', edgeIds: [1] },
			{ code: 'dates_may_move', taskIds: [10, 12] },
			{ code: 'history_kept' }
		]);
	});
});

describe('mergeNotes', () => {
	it('keeps one history note and joins edge ids and Task ids', () => {
		expect(
			mergeNotes([
				[{ code: 'edges_recreated', edgeIds: [1] }, { code: 'history_kept' }],
				[{ code: 'edges_recreated', edgeIds: [2] }, { code: 'dates_may_move', taskIds: [3] }, { code: 'violation_may_change', taskIds: [5] }, { code: 'history_kept' }],
				[{ code: 'violation_may_change', taskIds: [4] }]
			])
		).toEqual([
			{ code: 'edges_recreated', edgeIds: [1, 2] },
			{ code: 'dates_may_move', taskIds: [3] },
			{ code: 'violation_may_change', taskIds: [4, 5] },
			{ code: 'history_kept' }
		]);
	});
});

describe('resultRows', () => {
	it('one row per entity: clean, with differences, failed with retry, undone, not applied', () => {
		const rec = (n: number) => record(shot(n));
		const r = run([
			{ entity: shot(1), status: { state: 'done', undo: rec(1) } },
			{ entity: shot(2), status: { state: 'done', undo: rec(2) } },
			{ entity: shot(3), status: { state: 'failed', error: { status: 400, message: 'Bad' }, undo: null } },
			{ entity: shot(4), status: { state: 'undone', undo: rec(4) } },
			{ entity: shot(5), status: { state: 'pending' } },
			{ entity: shot(6), status: { state: 'done', undo: rec(6) } },
			{ entity: shot(7), status: { state: 'failed', error: { status: null, message: 'Interrupted' }, undo: rec(7) } }
		]);
		const outcomes = [
			{ entity: shot(1), result: { kind: 'ok' as const, entity: shot(1), created: [], addedEdges: [], differences: [] } },
			{
				entity: shot(2),
				result: { kind: 'ok' as const, entity: shot(2), created: [], addedEdges: [], differences: [{ code: 'delete_missing' as const, taskId: 10 }] }
			},
			{ entity: shot(3), result: { kind: 'failed' as const, entity: shot(3), error: { status: 400, message: 'Bad' } } }
		];
		const rows = resultRows(r, outcomes, nameBook([plan]), new Set(['Shot:3']));
		expect(rows.map((x) => [x.label, x.kind, x.differences, x.error, x.canUndo, x.canRetry])).toEqual([
			['sh1', 'clean', [], null, true, false],
			['sh2', 'differences', ['comp was not deleted.'], null, true, false],
			['sh3', 'failed', [], 'Bad', false, true],
			['sh4', 'undone', [], null, false, false],
			['sh5', 'not_applied', [], null, false, false],
			['sh6', 'landed', [], null, true, false],
			['sh7', 'failed', [], 'Interrupted', true, false]
		]);
	});
});

describe('groupRows', () => {
	it('groups rows by outcome, what needs a look first, empty groups left out, run order kept inside', () => {
		const row = (n: number, kind: ResultKind): ResultRow => ({
			key: `Shot:${n}`,
			entity: shot(n),
			label: `sh${n}`,
			kind,
			differences: [],
			error: null,
			record: null,
			canUndo: false,
			canRetry: false
		});
		const rows = [row(1, 'clean'), row(2, 'failed'), row(3, 'differences'), row(4, 'clean'), row(5, 'landed'), row(6, 'undone'), row(7, 'not_applied'), row(8, 'landing')];
		expect(groupRows(rows).map((g) => [g.kind, g.title, g.rows.map((r) => r.label)])).toEqual([
			['failed', 'Failed', ['sh2']],
			['differences', 'Landed with differences', ['sh3']],
			['landing', 'Landing', ['sh8']],
			['clean', 'Landed clean', ['sh1', 'sh4']],
			['landed', 'Landed earlier', ['sh5']],
			['undone', 'Undone', ['sh6']],
			['not_applied', 'Not applied', ['sh7']]
		]);
		expect(groupRows([])).toEqual([]);
	});
});

describe('undoFileName', () => {
	it('names the file by template and time', () => {
		expect(undoFileName(run([]))).toBe('undo-T-2026-09-24T10-00-00Z.json');
	});
});
