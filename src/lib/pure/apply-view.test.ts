import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import {
	applyEvent,
	cancelPending,
	entityLabel,
	initialLines,
	lineCounts,
	linesFromRun,
	newRun,
	resumedRun,
	startBlockers,
	summaryGroups,
	undoNote,
	writablePlans,
	writeSummary
} from './apply-view';
import type { EntityPlan, EntityTask, RunOptions, TemplateTask } from './types';

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
	entity: { type: 'Shot', id: 1 },
	templateTask: null,
	pinned: false,
	dependencyViolation: false,
	createdAt: '2026-09-01T00:00:00Z'
});
const edgePlan = () => ({ expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] });

function plan(id: number, extra: Partial<EntityPlan> = {}): EntityPlan {
	return {
		entity: { type: 'Shot', id, name: `sh${id}`, entityType: 'Shot', taskTemplate: null },
		templateId: 5,
		rows: [],
		edges: edgePlan(),
		counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false,
		...extra
	};
}

const edge = (id: number, down: number, up: number) => ({
	id,
	downstream: down,
	upstream: up,
	type: 'finish-to-start-next-day' as const,
	offsetDays: null
});

const busy = plan(1, {
	rows: [
		{
			kind: 'claim',
			task: task(10, 'comp'),
			templateTask: tt(500, 'Comp'),
			previousTemplateTask: null,
			fieldChanges: [
				{ field: 'sg_description', current: 'a', template: 'b', policy: 'overwrite', result: 'b' },
				{ field: 'duration', current: 1, template: 2, policy: 'keep', result: 1 }
			],
			rename: { from: 'comp', to: 'Comp', handRenamed: false }
		},
		{ kind: 'create', templateTask: tt(501, 'Grade'), templateDates: { start: '2026-10-01', due: '2026-10-02' }, datesClearable: true },
		{ kind: 'create', templateTask: tt(502, 'Roto'), templateDates: { start: null, due: null }, datesClearable: false },
		{ kind: 'extra', task: task(11, 'paint'), action: 'omit', usage: { versions: 0, publishedFiles: 0 }, reason: 'not_in_template' },
		{ kind: 'extra', task: task(12, 'old'), action: 'delete', usage: { versions: 1, publishedFiles: 0 }, reason: 'not_in_template' },
		{ kind: 'extra', task: task(13, 'lighting'), action: 'leave', usage: { versions: 0, publishedFiles: 0 }, reason: 'not_in_template' }
	],
	edges: {
		...edgePlan(),
		expectedAdded: [
			{ templateEdge: edge(1, 501, 500), downstream: { created: 501 }, upstream: { existing: 10 } }
		],
		affected: [
			{ existing: edge(70, 10, 13), cause: 'outside_upstream', replacedBy: null, action: 'keep' },
			{ existing: edge(71, 10, 11), cause: 'not_in_template', replacedBy: null, action: 'remove' }
		],
		mayMove: [10, 11],
		wouldViolate: [12]
	},
	counts: { keep: 0, claim: 1, create: 2, extra: 3, conflict: 0 }
});

describe('writeSummary', () => {
	it('counts what the run writes, over the entities that have something to write', () => {
		const s = writeSummary([busy, plan(2, { noop: true })], options({ clearCreatedDates: true, deleteConfirmed: true }));
		expect(s).toEqual({
			entities: 2,
			toWrite: 1,
			nothingToWrite: 1,
			totals: { keep: 0, claim: 1, create: 2, extra: 3, conflict: 0 },
			templateWrites: 1,
			claims: 1,
			creates: 2,
			overwrites: 1,
			writeBacks: 1,
			fillIfEmpty: 0,
			renames: 1,
			omits: 1,
			deletes: 1,
			deletesWithUsage: 1,
			leaves: 1,
			edgesAdded: 1,
			edgesRecreated: 1,
			edgesRemoved: 1,
			datesCleared: 1,
			mayMove: 2,
			wouldViolate: 1
		});
	});

	it('does not count deletes that are not confirmed, nor clears that are off', () => {
		const s = writeSummary([busy], options());
		expect(s.deletes).toBe(0);
		expect(s.deletesWithUsage).toBe(0);
		expect(s.datesCleared).toBe(0);
	});
});

describe('summaryGroups', () => {
	it('says what will be written in plain words, grouped, non-zero items only', () => {
		expect(summaryGroups(writeSummary([busy, plan(2, { noop: true })], options({ deleteConfirmed: true })))).toEqual([
			{
				title: 'Entities',
				lines: ['The template is set on 1 entity, in one atomic batch.', '1 entity already matches the template: skipped.']
			},
			{
				title: 'Tasks',
				lines: [
					'1 existing Task matched by name and Step, linked to the template; its status, assignees and publishes unchanged.',
					'2 Tasks created from the template.',
					"1 Task renamed to the template's name.",
					'1 Task not in the template set to the omit status.',
					'1 Task not in the template deleted, 1 with Versions or PublishedFiles.',
					'1 Task not in the template, not changed.'
				]
			},
			{
				title: 'Fields',
				lines: ["1 field overwritten with the template's value.", '1 field the template would overwrite, written back unchanged.']
			},
			{
				title: 'Dependencies and dates',
				lines: [
					'1 dependency added from the template.',
					'1 dependency removed by the apply, re-created (new ids).',
					'1 dependency removed.',
					'2 unpinned Tasks may be rescheduled by the new dependencies.',
					'1 pinned Task will be flagged as violating a dependency.'
				]
			}
		]);
	});
	it('leaves out a group with nothing in it', () => {
		const groups = summaryGroups(writeSummary([plan(4, { noop: true })], options()));
		expect(groups).toEqual([{ title: 'Entities', lines: ['1 entity already matches the template: skipped.'] }]);
	});
});

describe('startBlockers', () => {
	it('is empty for a plan that can run', () => {
		expect(startBlockers([busy], options({ deleteConfirmed: true }))).toEqual([]);
	});
	it('names unresolved conflicts, unconfirmed deletes, a missing omit status, and an empty run', () => {
		const conflicted = plan(3, { warnings: [{ code: 'unresolved_conflict', templateTaskIds: [500] }] });
		expect(startBlockers([busy, conflicted], options({ omitStatus: '' }))).toEqual([
			'1 entity has a Task that needs a choice. Pick it on the plan.',
			'1 Task is marked delete but the delete is not confirmed. Confirm it on the plan, or leave the Task.',
			'1 Task is marked omit but no omit status is chosen. Choose one on the plan.'
		]);
		expect(startBlockers([plan(4, { noop: true })], options())).toEqual(['Nothing to write: every entity already matches the template.']);
	});
});

describe('undoNote', () => {
	it('says where the undo record lives', () => {
		expect(undoNote(true)).toEqual({
			persistent: true,
			lines: [
				'Each entity is one atomic batch: it lands whole or not at all.',
				'Its undo record is stored in this browser as it lands. Download it to undo from another browser.'
			]
		});
		const off = undoNote(false);
		expect(off.persistent).toBe(false);
		expect(off.lines[1]).toBe(
			'This browser cannot store the undo record: it lives in this tab only. Download it before you close the tab, or undo is lost.'
		);
	});
});

describe('lines', () => {
	it('start pending, one per writable plan, labelled by name', () => {
		const lines = initialLines(writablePlans([busy, plan(2, { noop: true }), plan(3)]));
		expect(lines.map((l) => [l.key, l.label, l.state])).toEqual([
			['Shot:1', 'sh1', 'pending'],
			['Shot:3', 'sh3', 'pending']
		]);
	});

	it('follow the runner: applying lands, done landed, failed with the error title verbatim', () => {
		let lines = initialLines([busy, plan(3)]);
		lines = applyEvent(lines, { entity: busy.entity, state: 'applying' });
		expect(lines[0].state).toBe('landing');
		lines = applyEvent(lines, { entity: busy.entity, state: 'done' });
		lines = applyEvent(lines, { entity: plan(3).entity, state: 'failed', error: { status: 400, message: 'The field is not editable for this user' } });
		expect(lines.map((l) => [l.state, l.error])).toEqual([
			['landed', null],
			['failed', 'The field is not editable for this user']
		]);
		expect(lineCounts(lines)).toEqual({ pending: 0, landing: 0, landed: 1, failed: 1, cancelled: 0, undone: 0 });
	});

	it('cancel marks what never started', () => {
		const lines = cancelPending(applyEvent(initialLines([busy, plan(3)]), { entity: busy.entity, state: 'done' }));
		expect(lines.map((l) => l.state)).toEqual(['landed', 'cancelled']);
	});

	it('read back from a stored run', () => {
		const rec = { runId: 'r' } as never;
		const run = newRun({
			id: 'r',
			project: { type: 'Project', id: 1 },
			template: { id: 5, code: 'T' },
			user: { type: 'HumanUser', id: 9 },
			options: options(),
			plans: [busy, plan(2), plan(3), plan(4), plan(6, { noop: true })],
			now: '2026-09-24T10:00:00Z'
		});
		expect(run.entities.length).toBe(4);
		expect(run.finishedAt).toBeNull();
		// The entry point is retired (#59): a new run stores none.
		expect('entryPoint' in run).toBe(false);
		run.entities[0].status = { state: 'done', undo: rec };
		run.entities[1].status = { state: 'failed', error: { status: null, message: 'boom' }, undo: null };
		run.entities[2].status = { state: 'applying' };
		run.entities[3].status = { state: 'undone', undo: rec };
		expect(linesFromRun(run).map((l) => [l.state, l.error])).toEqual([
			['landed', null],
			['failed', 'boom'],
			['landing', null],
			['undone', null]
		]);
	});

	it('label falls back to type and id', () => {
		expect(entityLabel({ type: 'Asset', id: 7 })).toBe('Asset 7');
	});
});

describe('resumedRun', () => {
	it('puts the re-planned entities back to pending with the new options, landed ones as they were', () => {
		const rec = { runId: 'r' } as never;
		const stored = newRun({
			id: 'r',
			project: { type: 'Project', id: 1 },
			template: { id: 5, code: 'T' },
			user: { type: 'HumanUser', id: 9 },
			options: options(),
			plans: [plan(1), plan(2)],
			now: '2026-09-24T10:00:00Z'
		});
		stored.entities[0].status = { state: 'done', undo: rec };
		stored.entities[1].status = { state: 'applying' };
		const next = resumedRun({ ...stored, finishedAt: 'x' }, [plan(2)], options({ omitStatus: 'hld' }));
		expect(next.id).toBe('r');
		expect(next.finishedAt).toBeNull();
		expect(next.options.omitStatus).toBe('hld');
		expect(next.entities.map((e) => e.status.state)).toEqual(['done', 'pending']);
	});
});
