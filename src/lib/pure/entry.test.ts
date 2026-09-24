import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import {
	accessSample,
	chunk,
	defaultRunOptions,
	addToSelection,
	entityListFilters,
	legacyFilter,
	openingFilter,
	storedFilter,
	onlySelected,
	planBlocker,
	selectedWithin,
	selectionLine,
	planTotals,
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
	const tpl = { type: 'TaskTemplate', id: 5 };

	it('lists every entity of the project on All', () => {
		expect(entityListFilters(70, 'all', 5, '')).toEqual({ logical_operator: 'and', conditions: [project] });
	});

	it('narrows to the template on Using this template', () => {
		expect(entityListFilters(70, 'using', 5, '').conditions).toEqual([project, ['task_template', 'is', tpl]]);
	});

	it('narrows to entities on another template: not this one and not none (negation keeps nulls, doors/field_types)', () => {
		expect(entityListFilters(70, 'other', 5, '').conditions).toEqual([
			project,
			['task_template', 'is_not', tpl],
			['task_template', 'is_not', null]
		]);
	});

	it('narrows to entities with no template', () => {
		expect(entityListFilters(70, 'none', 5, '').conditions).toEqual([project, ['task_template', 'is', null]]);
	});

	it('needs every word of the search in the code, one contains per word (sg-widgets nameSearchFilter, doors/findings-filter)', () => {
		expect(entityListFilters(70, 'all', null, '  sh01   anim ').conditions).toEqual([
			project,
			['code', 'contains', 'sh01'],
			['code', 'contains', 'anim']
		]);
	});

	it('adds a trimmed code search, and skips a blank one', () => {
		expect(entityListFilters(70, 'none', null, '  sh01 ').conditions).toContainEqual(['code', 'contains', 'sh01']);
		expect(entityListFilters(70, 'all', null, '   ').conditions).toHaveLength(1);
	});

	it('has no template condition on Using or Other when no template is picked', () => {
		expect(entityListFilters(70, 'using', null, '').conditions).toEqual([project]);
		expect(entityListFilters(70, 'other', null, '').conditions).toEqual([project, ['task_template', 'is_not', null]]);
	});
});

describe('the list filter', () => {
	it('opens on Using this template when an entity uses it, else on All', () => {
		expect(openingFilter(3)).toBe('using');
		expect(openingFilter(0)).toBe('all');
	});

	it('maps a retired entry point to the filter it implied', () => {
		expect(legacyFilter('template_first')).toBe('using');
		expect(legacyFilter('entities_first')).toBe('all');
		expect(legacyFilter('no_template')).toBe('none');
		expect(legacyFilter(undefined)).toBeNull();
		expect(legacyFilter('bogus')).toBeNull();
	});

	it('keeps a stored filter when it is one of the four, else reads the retired entry point', () => {
		expect(storedFilter('other')).toBe('other');
		expect(storedFilter('nope')).toBeNull();
		expect(storedFilter(null, 'no_template')).toBe('none');
		expect(storedFilter(undefined, 'template_first')).toBe('using');
		expect(storedFilter('all', 'no_template')).toBe('all');
		expect(storedFilter(undefined)).toBeNull();
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

	it('narrows both lists to codes holding the query, trimmed and case-insensitive', () => {
		const all = [template(1, 'TT Seed · Shot v1', 'Shot'), template(2, 'anim-shot', 'Shot'), template(3, 'TT Seed · Asset', 'Asset')];
		const { matching, others } = templatesByType(all, 'Shot', '  tt seed ');
		expect(matching.map((t) => t.id)).toEqual([1]);
		expect(others.map((t) => t.id)).toEqual([3]);
		expect(templatesByType(all, 'Shot', '').matching).toHaveLength(2);
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

	it('prefers a Task the run writes (keep or claim), with the policy fields, step included', () => {
		const kept = task(10, 'Anim', { entity: { type: 'Shot', id: 2 } });
		const plans = [
			plan(1, [{ kind: 'create', templateTask: tpl.tasks[0], templateDates: { start: null, due: null }, datesClearable: true }]),
			plan(2, [{ kind: 'keep', task: kept, templateTask: tpl.tasks[0], keyMismatch: false, fieldChanges: [], rename: null }])
		];
		const sample = accessSample(plans, [], tpl);
		expect(sample?.task.id).toBe(10);
		expect(sample?.entity.id).toBe(2);
		// access.ts sends `step` back as a Step link (field_types/entity).
		expect(sample?.fields).toEqual(['content', 'sg_description', 'step']);
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

describe('selection across filters', () => {
	const ref = (id: number, name?: string) => ({ type: 'Shot', id, ...(name ? { name } : {}) });

	it('adds what select all matching found and keeps what was picked before', () => {
		expect(addToSelection([ref(1, 'a'), ref(2)], [ref(2, 'b'), ref(3, 'c')])).toEqual([ref(1, 'a'), ref(2), ref(3, 'c')]);
		expect(addToSelection([], [ref(4)])).toEqual([ref(4)]);
	});

	it('narrows the list filter to the selected ids, to count or to show them', () => {
		const list = entityListFilters(70, 'none', 5, 'sh');
		expect(selectedWithin(list, [ref(1), ref(2)])).toEqual({
			logical_operator: 'and',
			conditions: [...list.conditions, ['id', 'in', [1, 2]]]
		});
		expect(onlySelected(70, [ref(3)])).toEqual({
			logical_operator: 'and',
			conditions: [['project', 'is', { type: 'Project', id: 70 }], ['id', 'in', [3]]]
		});
	});

	it('says how many are selected and how many of them the filter hides', () => {
		expect(selectionLine(5, 3)).toEqual({ selected: 5, hidden: 2 });
		expect(selectionLine(5, null)).toEqual({ selected: 5, hidden: 0 });
		expect(selectionLine(2, 7)).toEqual({ selected: 2, hidden: 0 });
		expect(selectionLine(0, 0)).toEqual({ selected: 0, hidden: 0 });
	});
});
