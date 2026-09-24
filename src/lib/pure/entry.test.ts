import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import {
	accessSample,
	chunk,
	defaultRunOptions,
	entityListFilters,
	planBlocker,
	planTotals,
	templateEdgeRows,
	templatesByType
} from './entry';
import type { EntityPlan, EntitySnapshot, EntityTask, ProjectContext, Template, TemplateTask } from './types';

const ctx = (statuses: string[]): ProjectContext => ({
	project: { type: 'Project', id: 70 },
	defaultTaskStatus: 'wtg',
	validTaskStatuses: statuses
});

function task(id: number, content: string, extra: Partial<EntityTask> = {}): EntityTask {
	return {
		id,
		content,
		step: { type: 'Step', id: 11, name: 'Anim' },
		key: matchKey(content, 11),
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
		fields: { content, step: 11, sg_description: 'd' },
		entity: { type: 'Shot', id: 1 },
		templateTask: null,
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-01T00:00:00Z',
		...extra
	};
}

function tplTask(id: number, content: string): TemplateTask {
	const { entity: _e, templateTask: _t, pinned: _p, dependencyViolation: _d, createdAt: _c, ...core } = task(id, content);
	return { ...core, templateId: 5 };
}

const template = (id: number, code: string, entityType: string | null, extra: Partial<Template> = {}): Template => ({
	id,
	code,
	entityType,
	tasks: [],
	edges: [],
	...extra
});

const entity = (id: number): EntitySnapshot['entity'] => ({
	type: 'Shot',
	id,
	name: `SH${id}`,
	entityType: 'Shot',
	taskTemplate: null
});

function plan(id: number, rows: EntityPlan['rows'], counts: Partial<EntityPlan['counts']> = {}, noop = false): EntityPlan {
	return {
		entity: entity(id),
		templateId: 5,
		rows,
		edges: { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] },
		counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0, ...counts },
		warnings: [],
		needsClearFirst: false,
		noop
	};
}

describe('entityListFilters', () => {
	const project = ['project', 'is', { type: 'Project', id: 70 }];

	it('lists every entity of the project when picking entities first', () => {
		expect(entityListFilters(70, 'entities_first', 5, '')).toEqual({ logical_operator: 'and', conditions: [project] });
	});

	it('narrows to the template when the template comes first', () => {
		expect(entityListFilters(70, 'template_first', 5, '').conditions).toEqual([
			project,
			['task_template', 'is', { type: 'TaskTemplate', id: 5 }]
		]);
	});

	it('narrows to entities with no template', () => {
		expect(entityListFilters(70, 'no_template', 5, '').conditions).toEqual([project, ['task_template', 'is', null]]);
	});

	it('adds a trimmed code search, and skips a blank one', () => {
		expect(entityListFilters(70, 'no_template', null, '  sh01 ').conditions).toContainEqual(['code', 'contains', 'sh01']);
		expect(entityListFilters(70, 'entities_first', null, '   ').conditions).toHaveLength(1);
	});

	it('has no template condition when the template comes first but none is picked', () => {
		expect(entityListFilters(70, 'template_first', null, '').conditions).toEqual([project]);
	});
});

describe('templatesByType', () => {
	it('puts the type’s own templates first, the rest apart, each sorted by code', () => {
		const all = [template(1, 'b shot', 'Shot'), template(2, 'asset', 'Asset'), template(3, 'A shot', 'Shot'), template(4, 'loose', null)];
		const { matching, others } = templatesByType(all, 'Shot');
		expect(matching.map((t) => t.id)).toEqual([3, 1]);
		expect(others.map((t) => t.id)).toEqual([2, 4]);
	});

	it('offers nothing as matching when no type is chosen', () => {
		const { matching, others } = templatesByType([template(1, 'x', 'Shot')], null);
		expect(matching).toEqual([]);
		expect(others).toHaveLength(1);
	});
});

describe('templateEdgeRows', () => {
	it('names both ends by task content; task is downstream, dependent_task upstream (085)', () => {
		const t = template(5, 'T', 'Shot', {
			tasks: [tplTask(100, 'Layout'), tplTask(101, 'Anim')],
			edges: [{ id: 900, downstream: 101, upstream: 100, type: 'start-to-start', offsetDays: -2 }]
		});
		expect(templateEdgeRows(t)).toEqual([
			{ id: 900, upstream: 'Layout', downstream: 'Anim', type: 'start-to-start', offsetDays: -2 }
		]);
	});

	it('falls back to the task id when a task is not in the template', () => {
		const t = template(5, 'T', 'Shot', {
			tasks: [tplTask(100, 'Layout')],
			edges: [{ id: 901, downstream: 777, upstream: 100, type: 'finish-to-start-next-day', offsetDays: null }]
		});
		expect(templateEdgeRows(t)[0].downstream).toBe('Task 777');
	});
});

describe('chunk', () => {
	it('splits in order, the last chunk short', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 3)).toEqual([]);
	});

	it('refuses a size under one', () => {
		expect(() => chunk([1], 0)).toThrow();
	});
});

describe('defaultRunOptions', () => {
	it('starts on the brief’s defaults, omit status the project’s stock omt when valid', () => {
		expect(defaultRunOptions(ctx(['wtg', 'ip', 'omt']))).toEqual({
			fieldPolicies: {},
			extraByName: {},
			extraOverrides: {},
			omitStatus: 'omt',
			conflictPicks: {},
			edgeActions: {},
			clearCreatedDates: false,
			deleteConfirmed: false
		});
	});

	it('leaves the omit status empty when the project has no omt: never guessed', () => {
		expect(defaultRunOptions(ctx(['wtg', 'ip'])).omitStatus).toBe('');
	});
});

describe('planTotals', () => {
	it('sums the five counts across plans and counts the no-ops', () => {
		const totals = planTotals([plan(1, [], { keep: 2, create: 1 }), plan(2, [], { claim: 1, extra: 3, conflict: 1 }), plan(3, [], {}, true)]);
		expect(totals).toEqual({ entities: 3, noop: 1, keep: 2, claim: 1, create: 1, extra: 3, conflict: 1 });
	});
});

describe('accessSample', () => {
	const tpl = template(5, 'T', 'Shot', { tasks: [tplTask(100, 'Anim')] });

	it('prefers a Task the run writes (keep or claim), with the policy fields but not step', () => {
		const kept = task(10, 'Anim', { entity: { type: 'Shot', id: 2 } });
		const plans = [
			plan(1, [{ kind: 'create', templateTask: tpl.tasks[0], templateDates: { start: null, due: null }, datesClearable: true }]),
			plan(2, [{ kind: 'keep', task: kept, templateTask: tpl.tasks[0], keyMismatch: false, fieldChanges: [], rename: null }])
		];
		const sample = accessSample(plans, [], tpl);
		expect(sample?.task.id).toBe(10);
		expect(sample?.entity.id).toBe(2);
		// `fields.step` is flattened to an id (read.ts): as a PUT body it is not the wire shape.
		expect(sample?.fields).toEqual(['content', 'sg_description']);
	});

	it('falls back to any Task on a selected entity', () => {
		const snap: EntitySnapshot = { entity: entity(3), tasks: [task(30, 'Other', { entity: { type: 'Shot', id: 3 } })], edges: [], usage: {}, readAt: '' };
		const sample = accessSample([plan(3, [])], [snap], tpl);
		expect(sample?.task.id).toBe(30);
		expect(sample?.entity.id).toBe(3);
	});

	it('is null when no selected entity has a Task', () => {
		expect(accessSample([plan(1, [])], [{ entity: entity(1), tasks: [], edges: [], usage: {}, readAt: '' }], tpl)).toBeNull();
	});
});

describe('planBlocker', () => {
	const ok = { project: { type: 'Project', id: 70 }, entityType: 'Shot', template: template(5, 'T', 'Shot'), selected: 2 };

	it('is null when a plan can be built', () => {
		expect(planBlocker(ok)).toBeNull();
	});

	it('names the first thing missing, in screen order', () => {
		expect(planBlocker({ ...ok, project: null })).toBe('Pick a project.');
		expect(planBlocker({ ...ok, entityType: null })).toBe('Pick an entity type.');
		expect(planBlocker({ ...ok, template: null })).toBe('Pick a template.');
		expect(planBlocker({ ...ok, selected: 0 })).toBe('Select at least one entity.');
	});
});
