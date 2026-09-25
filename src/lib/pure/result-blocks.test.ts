import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import { entityTasks, recordTally, resultBlocks, runTotals, unchangedLine } from './result-blocks';
import type { ResultRow } from './result-view';
import type { EntityPlan, EntityRef, EntityTask, TemplateTask, UndoRecord } from './types';

const shot = (id: number): EntityRef => ({ type: 'Shot', id, name: `sh${id}` });
const step = (id: number, name: string): EntityRef => ({
	type: 'Step',
	id,
	name
});
const COMP = step(8, 'Comp');
const LIGHT = step(7, 'Lighting');

function core(id: number, content: string, s: EntityRef | null) {
	return {
		id,
		content,
		step: s,
		key: matchKey(content, s?.id ?? null),
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
const tt = (id: number, content: string, s: EntityRef | null): TemplateTask => ({ ...core(id, content, s), templateId: 5 });
const task = (id: number, content: string, s: EntityRef | null, status = 'wtg'): EntityTask => ({
	...core(id, content, s),
	status,
	entity: shot(1),
	templateTask: null,
	pinned: false,
	dependencyViolation: false,
	createdAt: '2026-09-01T00:00:00Z'
});

function plan(id: number, rows: EntityPlan['rows'], noop = false): EntityPlan {
	return {
		entity: { ...shot(id), entityType: 'Shot', taskTemplate: null },
		templateId: 5,
		rows,
		edges: {
			expectedAdded: [],
			affected: [],
			toExtras: [],
			mayMove: [],
			wouldViolate: []
		},
		counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop
	};
}

const usage = { versions: 0, publishedFiles: 0 };

const shot1 = plan(1, [
	{
		kind: 'keep',
		task: task(10, 'Light', LIGHT),
		templateTask: tt(500, 'Light', LIGHT),
		keyMismatch: false,
		fieldChanges: [],
		rename: null
	},
	{
		kind: 'claim',
		task: task(11, 'comp ', COMP),
		templateTask: tt(501, 'Comp', COMP),
		previousTemplateTask: null,
		fieldChanges: [],
		rename: { from: 'comp ', to: 'Comp', handRenamed: false }
	},
	{
		kind: 'create',
		templateTask: tt(502, 'Roto', COMP),
		templateDates: { start: null, due: null },
		datesClearable: true
	},
	{
		kind: 'create',
		templateTask: tt(503, 'Prep', null),
		templateDates: { start: null, due: null },
		datesClearable: true
	},
	{
		kind: 'extra',
		task: task(12, 'Old paint', COMP),
		action: 'omit',
		usage,
		reason: 'not_in_template'
	},
	{
		kind: 'extra',
		task: task(13, 'Temp', null),
		action: 'delete',
		usage,
		reason: 'not_in_template'
	},
	{
		kind: 'extra',
		task: task(14, 'Notes', LIGHT),
		action: 'leave',
		usage,
		reason: 'not_in_template'
	}
]);

describe('entityTasks', () => {
	it('groups the Tasks by Pipeline Step in plan order, one line each with its outcome', () => {
		const groups = entityTasks(shot1, [{ templateTaskId: 502, taskId: 900 }], 'omt');
		expect(groups.map((g) => [g.step, g.lines.map((l) => [l.name, l.taskId, l.label, l.note])])).toEqual([
			[
				'Lighting',
				[
					['Light', 10, 'Already linked', null],
					['Notes', 14, 'Not in template', null]
				]
			],
			[
				'Comp',
				[
					['Comp', 11, 'Linked', 'Renamed from comp'],
					['Roto', 900, 'Created', null],
					['Old paint', 12, 'Not in template', 'Status set to omt']
				]
			],
			[
				'No Step',
				[
					['Prep', null, 'Created', 'Not created'],
					['Temp', 13, 'Not in template', 'Deleted']
				]
			]
		]);
	});

	it('leaves out an open conflict row: the plan resolved it before the apply', () => {
		const p = plan(2, [
			{
				kind: 'conflict',
				key: matchKey('comp', 8),
				templateTasks: [tt(501, 'Comp', COMP)],
				candidates: [],
				prePick: {},
				reason: 'only',
				pick: {}
			}
		]);
		expect(entityTasks(p, [], 'omt')).toEqual([]);
	});
});

function record(entity: EntityRef, extra: Partial<UndoRecord> = {}): UndoRecord {
	return {
		version: 1,
		runId: 'run-1',
		entity,
		templateId: 5,
		appliedAt: '2026-09-24T10:00:00Z',
		previousTaskTemplate: null,
		claimed: [],
		created: [],
		fieldValues: [],
		omitted: [],
		deletedTasks: [],
		droppedEdges: [],
		recreatedEdges: [],
		deletedEdges: [],
		addedEdges: [],
		clearedDates: [],
		...extra
	};
}

describe('recordTally', () => {
	it('counts what an undo record says was written, for a run this tab did not plan', () => {
		const rec = record(shot(1), {
			claimed: [{ taskId: 1, previousTemplateTask: null }],
			created: [2, 3],
			omitted: [{ taskId: 4, previousStatus: 'wtg' }],
			deletedTasks: [5]
		});
		expect(recordTally(rec)).toBe('2 created, 1 linked, 1 omitted, 1 deleted');
		expect(recordTally(record(shot(1)))).toBe('Nothing written');
	});
});

const row = (n: number, kind: ResultRow['kind'], extra: Partial<ResultRow> = {}): ResultRow => ({
	key: `Shot:${n}`,
	entity: shot(n),
	label: `sh${n}`,
	kind,
	differences: [],
	error: null,
	record: record(shot(n)),
	canUndo: kind !== 'failed',
	canRetry: false,
	...extra
});

describe('resultBlocks', () => {
	it('gives each applied entity its Tasks; a failed or undone one none; a stored one its record tally', () => {
		const rows = [row(1, 'clean'), row(2, 'failed', { error: 'Bad', record: null }), row(3, 'undone'), row(4, 'landed')];
		const outcomes = [
			{
				entity: shot(1),
				result: {
					kind: 'ok' as const,
					entity: shot(1),
					created: [900],
					createdFor: [{ templateTaskId: 502, taskId: 900 }],
					addedEdges: [],
					differences: []
				}
			}
		];
		const blocks = resultBlocks(rows, [shot1, plan(2, [])], outcomes, 'omt');
		expect(blocks.map((b) => [b.label, b.steps.length, b.tally])).toEqual([
			['sh2', 0, null],
			['sh1', 3, null],
			['sh4', 0, 'Nothing written'],
			['sh3', 0, null]
		]);
	});

	it('shows what needs a look first: failed, then with differences, then the rest in run order', () => {
		const rows = [row(1, 'clean'), row(2, 'differences'), row(3, 'failed'), row(4, 'clean')];
		expect(resultBlocks(rows, [], [], 'omt').map((b) => b.label)).toEqual(['sh3', 'sh2', 'sh1', 'sh4']);
	});

	it('puts the applied entities before the undone and the never applied ones; a retry in flight stays up', () => {
		const rows = [row(1, 'not_applied'), row(2, 'undone'), row(3, 'landed'), row(4, 'clean'), row(5, 'landing'), row(6, 'failed')];
		expect(resultBlocks(rows, [], [], 'omt').map((b) => b.label)).toEqual(['sh6', 'sh5', 'sh3', 'sh4', 'sh2', 'sh1']);
	});

	it('counts each block’s Tasks by outcome for its one line; none without Tasks', () => {
		const outcomes = [
			{
				entity: shot(1),
				result: {
					kind: 'ok' as const,
					entity: shot(1),
					created: [900],
					createdFor: [{ templateTaskId: 502, taskId: 900 }],
					addedEdges: [],
					differences: []
				}
			}
		];
		const blocks = resultBlocks([row(1, 'clean'), row(2, 'failed')], [shot1, plan(2, shot1.rows)], outcomes, 'omt');
		expect(blocks.map((b) => [b.label, b.counts.map((c) => c.text)])).toEqual([
			['sh2', []],
			['sh1', ['1 created', '1 linked', '1 already linked', '3 not in template']]
		]);
	});
});

describe('runTotals', () => {
	it('adds the Tasks of the applied entities by outcome, in the plan’s words', () => {
		const outcomes = [
			{
				entity: shot(1),
				result: {
					kind: 'ok' as const,
					entity: shot(1),
					created: [900],
					createdFor: [{ templateTaskId: 502, taskId: 900 }],
					addedEdges: [],
					differences: []
				}
			}
		];
		const blocks = resultBlocks([row(1, 'clean'), row(2, 'failed')], [shot1, plan(2, shot1.rows)], outcomes, 'omt');
		expect(runTotals(blocks)).toEqual([
			{ kind: 'create', count: 1, text: '1 created' },
			{ kind: 'claim', count: 1, text: '1 linked' },
			{ kind: 'keep', count: 1, text: '1 already linked' },
			{ kind: 'extra', count: 3, text: '3 not in template' }
		]);
	});
});

describe('unchangedLine', () => {
	it('folds the entities with nothing to write into one line', () => {
		const plans = [plan(1, [], true), plan(2, []), plan(3, [], true)];
		expect(unchangedLine(plans, 'Shot')).toBe('2 Shots unchanged');
		expect(unchangedLine([plan(1, [], true)], 'Shot')).toBe('1 Shot unchanged');
		expect(unchangedLine([plan(1, [], true)], null)).toBe('1 entity unchanged');
		expect(unchangedLine([plan(2, [])], 'Shot')).toBeNull();
	});
});
