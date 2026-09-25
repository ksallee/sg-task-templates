import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import {
	applyEvent,
	applyTitle,
	canCancel,
	cancelPending,
	countsLine,
	failureText,
	entityLabel,
	initialLines,
	lineCounts,
	linesFromRun,
	newRun,
	resumedRun,
	writablePlans
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

describe('the run in words', () => {
	const counts = (o: Partial<ReturnType<typeof lineCounts>> = {}) => ({ pending: 0, landing: 0, landed: 0, failed: 0, cancelled: 0, undone: 0, ...o });

	it('countsLine says only what is non-zero', () => {
		expect(countsLine(counts({ landing: 3 }))).toBe('3 applying');
		expect(countsLine(counts({ landed: 2, failed: 1, pending: 4 }))).toBe('2 applied, 1 failed, 4 not started');
		expect(countsLine(counts())).toBe('nothing applied');
	});

	it('countsLine takes other words for a state', () => {
		expect(countsLine(counts({ landing: 1 }), { landing: 'applying when the tab closed' })).toBe('1 applying when the tab closed');
	});

	it('the title says a failure', () => {
		expect(applyTitle('running', counts({ landing: 2 }))).toBe('Applying');
		expect(applyTitle('done', counts({ landed: 3 }))).toBe('Applied');
		expect(applyTitle('done', counts({ landed: 2, failed: 1 }))).toBe('Applied, 1 failed');
		expect(applyTitle('done', counts({ failed: 2 }))).toBe('Failed');
		expect(applyTitle('done', counts({ landed: 1, cancelled: 3 }))).toBe('Applied, 3 cancelled');
	});

	it('cancel after current stops something only while entities wait', () => {
		expect(canCancel(counts({ landing: 4 }))).toBe(false);
		expect(canCancel(counts({ landing: 4, pending: 1 }))).toBe(true);
	});
});

describe('failureText', () => {
	const error = { status: 400, message: 'Invalid field value, update failed [5 - Update failed for [TaskDependency.dependent_task]: Value is not legal.]' };

	it('says in plain words where it stopped and whether anything was written; the server text is the detail', () => {
		expect(failureText({ error, stage: 'apply', written: [] }, 'Shot')).toEqual({ text: 'Flow PT refused the write. Nothing was written.', detail: error.message });
		expect(failureText({ error, stage: 'apply', written: null }, 'Shot')).toEqual({ text: 'Flow PT refused the write. Reading the Shot after it failed.', detail: error.message });
		expect(failureText({ error, stage: 'after_apply' }, 'Shot').text).toBe('Applied, then Flow PT refused the date and dependency fixes.');
		expect(failureText({ error, stage: 'read_back' }, 'Shot').text).toBe('Applied, then reading the Shot back failed.');
		expect(failureText({ error, stage: 'read' }, 'Shot').text).toBe('Reading the Shot before the write failed. Nothing was written.');
		expect(failureText({ error, stage: 'changed', drift: [] }, 'Shot')).toEqual({ text: 'The Shot changed on Flow PT since the plan. Nothing was written.', detail: null });
		expect(failureText({ error, stage: 'interrupted', written: [] }, 'Shot')).toEqual({ text: 'The tab closed while this Shot was applying. Nothing was written.', detail: null });
		expect(failureText({ error, stage: 'interrupted', written: [{ code: 'task_added', task: { id: 1, name: 'x' } }] }, 'Shot').text).toBe(
			'The tab closed while this Shot was applying.'
		);
	});

	it('our own message is plain already; a run stored before stages shows its message', () => {
		expect(failureText({ error: { status: null, message: '"gone" is not a Task status in this project.' }, stage: 'validate' }, 'Shot')).toEqual({
			text: '"gone" is not a Task status in this project.',
			detail: null
		});
		expect(failureText({ error }, 'Shot')).toEqual({ text: error.message, detail: null });
	});

	it('lines from the runner and from the store use it', () => {
		const lines = applyEvent(initialLines([plan(3)]), { entity: plan(3).entity, state: 'failed', stage: 'apply', written: [], error });
		expect(lines[0].error).toBe('Flow PT refused the write. Nothing was written.');
	});
});
