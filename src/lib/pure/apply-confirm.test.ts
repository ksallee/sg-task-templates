import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import { applyConfirm } from './apply-confirm';
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

const labels = { sg_description: 'Description' };

describe('applyConfirm', () => {
	it('one line of totals over the entities it writes', () => {
		const c = applyConfirm([busy, plan(2, { noop: true })], options({ deleteConfirmed: true }), 'Shot', labels);
		expect(c.headline).toBe('Apply to 1 Shot: 2 Tasks created, 1 linked.');
		const many = applyConfirm([busy, plan(3, { rows: busy.rows })], options(), 'Shot', labels);
		expect(many.headline).toBe('Apply to 2 Shots: 4 Tasks created, 2 linked.');
	});

	it('leaves zero totals out, and says entities when the type is unknown', () => {
		expect(applyConfirm([plan(4)], options(), null, {}).headline).toBe('Apply to 1 entity.');
		const created = plan(5, { rows: [busy.rows[1]] });
		expect(applyConfirm([created, plan(6)], options(), null, {}).headline).toBe('Apply to 2 entities: 1 Task created.');
	});

	it('lists only the risky items: deletes with publish counts, omits, hand renames, overwritten fields', () => {
		const handRenamed = plan(7, {
			rows: [
				{
					kind: 'keep',
					task: task(20, 'comp v2'),
					templateTask: tt(500, 'Comp'),
					keyMismatch: true,
					fieldChanges: [{ field: 'sg_description', current: 'x', template: 'y', policy: 'overwrite', result: 'y' }],
					rename: { from: 'comp v2', to: 'Comp', handRenamed: true }
				}
			]
		});
		const c = applyConfirm([busy, handRenamed], options({ deleteConfirmed: true }), 'Shot', labels);
		expect(c.sections).toEqual([
			{ title: 'Deleted', lines: [{ text: 'sh1 · old #12: 1 Version, 0 PublishedFiles', loud: true }] },
			{ title: 'Omitted', lines: [{ text: '1 Task not in the template gets status omt.', loud: false }] },
			{ title: "Renamed by hand, gets the template's name", lines: [{ text: 'sh7 · comp v2 to Comp', loud: false }] },
			{ title: 'Overwritten from the template', lines: [{ text: 'Description on 2 Tasks', loud: false }] }
		]);
	});

	it('leaves the Task name out of the overwrites: only hand renames are risky', () => {
		const renamed = plan(10, {
			rows: [
				{
					kind: 'claim',
					task: task(40, 'comp'),
					templateTask: tt(500, 'Comp'),
					previousTemplateTask: null,
					fieldChanges: [{ field: 'content', current: 'comp', template: 'Comp', policy: 'overwrite', result: 'Comp' }],
					rename: { from: 'comp', to: 'Comp', handRenamed: false }
				}
			]
		});
		expect(applyConfirm([renamed], options(), 'Shot', labels).sections).toEqual([]);
	});

	it('has no sections when nothing is risky', () => {
		const safe = plan(8, { rows: [busy.rows[1], busy.rows[5]] });
		expect(applyConfirm([safe], options(), 'Shot', labels).sections).toEqual([]);
	});

	it('a delete with no publishes is listed, not loud', () => {
		const p = plan(9, { rows: [{ kind: 'extra', task: task(30, 'tmp'), action: 'delete', usage: { versions: 0, publishedFiles: 2 }, reason: 'not_in_template' }, { kind: 'extra', task: task(31, 'tmp2'), action: 'delete', usage: { versions: 0, publishedFiles: 0 }, reason: 'not_in_template' }] });
		expect(applyConfirm([p], options({ deleteConfirmed: true }), 'Shot', {}).sections[0].lines).toEqual([
			{ text: 'sh9 · tmp #30: 0 Versions, 2 PublishedFiles', loud: true },
			{ text: 'sh9 · tmp2 #31: 0 Versions, 0 PublishedFiles', loud: false }
		]);
	});
});
