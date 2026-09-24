import { describe, expect, it } from 'vitest';
import { matchKey } from './matching';
import { dependencyPhrase, offsetLabel, templateOutline } from './outline';
import type { Template, TemplateTask } from './types';

function tplTask(id: number, content: string, step: { id: number; name: string } | null, extra: Partial<TemplateTask> = {}): TemplateTask {
	return {
		id,
		content,
		step: step ? { type: 'Step', id: step.id, name: step.name } : null,
		key: matchKey(content, step?.id ?? null),
		status: null,
		sortOrder: null,
		duration: null,
		estInMins: null,
		description: null,
		milestone: false,
		startDate: null,
		dueDate: null,
		assignees: [],
		reviewers: [],
		fields: {},
		templateId: 5,
		...extra
	};
}

const LAYOUT = { id: 1, name: 'Layout' };
const ANIM = { id: 2, name: 'Animation' };
const COMP = { id: 3, name: 'Comp' };

const template = (tasks: TemplateTask[], edges: Template['edges'] = []): Template => ({ id: 5, code: 'T', entityType: 'Shot', tasks, edges });

describe('dependencyPhrase', () => {
	it('says each of the four types (085) in plain words, from the downstream side', () => {
		expect(dependencyPhrase('finish-to-start-next-day')).toBe('after');
		expect(dependencyPhrase('start-to-start')).toBe('starts with');
		expect(dependencyPhrase('finish-to-finish')).toBe('finishes with');
		expect(dependencyPhrase('start-to-finish-next-day')).toBe('finishes after start of');
	});

	it('prints the offset in working days, signed; null prints nothing, 0 prints (105: they differ)', () => {
		expect(offsetLabel(2)).toBe('+2 wd');
		expect(offsetLabel(-1)).toBe('−1 wd');
		expect(offsetLabel(0)).toBe('+0 wd');
		expect(offsetLabel(null)).toBeNull();
	});
});

describe('templateOutline', () => {
	it('groups the tasks by step in template order, the first task of a step placing the step', () => {
		const t = template([
			tplTask(10, 'Layout', LAYOUT),
			tplTask(11, 'Anim', ANIM),
			tplTask(12, 'Blocking', ANIM),
			tplTask(13, 'Comp', COMP)
		]);
		const out = templateOutline(t);
		expect(out.groups.map((g) => [g.step, g.tasks.map((x) => x.name)])).toEqual([
			['Layout', ['Layout']],
			['Animation', ['Anim', 'Blocking']],
			['Comp', ['Comp']]
		]);
		expect(out.taskCount).toBe(4);
		expect(out.edgeCount).toBe(0);
	});

	it('keeps a step split by another step as one group, where it first appears', () => {
		const t = template([tplTask(10, 'A', LAYOUT), tplTask(11, 'B', ANIM), tplTask(12, 'C', LAYOUT)]);
		expect(templateOutline(t).groups.map((g) => [g.step, g.tasks.map((x) => x.name)])).toEqual([
			['Layout', ['A', 'C']],
			['Animation', ['B']]
		]);
	});

	it('puts tasks with no step under "No step"', () => {
		const t = template([tplTask(10, 'Brief', null), tplTask(11, 'Layout', LAYOUT)]);
		expect(templateOutline(t).groups.map((g) => g.step)).toEqual(['No step', 'Layout']);
		expect(templateOutline(t).groups[0].stepId).toBeNull();
	});

	it('lists each task\'s upstream tasks with the phrase; task is downstream, dependent_task upstream (085)', () => {
		const t = template(
			[tplTask(10, 'Layout', LAYOUT), tplTask(11, 'Tracking', LAYOUT), tplTask(12, 'Anim', ANIM)],
			[
				{ id: 900, downstream: 12, upstream: 10, type: 'finish-to-start-next-day', offsetDays: null },
				{ id: 901, downstream: 12, upstream: 11, type: 'start-to-start', offsetDays: 2 }
			]
		);
		const anim = templateOutline(t).groups[1].tasks[0];
		expect(anim.after).toEqual([
			{ id: 900, upstream: 'Layout', phrase: 'after', offset: null },
			{ id: 901, upstream: 'Tracking', phrase: 'starts with', offset: '+2 wd' }
		]);
		expect(anim.feeds).toBe(0);
		const layout = templateOutline(t).groups[0].tasks[0];
		expect(layout.after).toEqual([]);
		expect(layout.feeds).toBe(1);
		expect(templateOutline(t).edgeCount).toBe(2);
	});

	it('carries order, duration, estimate and milestone for the row', () => {
		const t = template([tplTask(10, 'Review', COMP, { sortOrder: 90, duration: 0, estInMins: 30, milestone: true })]);
		expect(templateOutline(t).groups[0].tasks[0]).toMatchObject({ id: 10, name: 'Review', sortOrder: 90, duration: 0, estInMins: 30, milestone: true });
	});

	it('names a task by its id when it has no content, and an edge end outside the template by id', () => {
		const t = template([tplTask(10, '', LAYOUT, { content: null })], [{ id: 1, downstream: 10, upstream: 777, type: 'finish-to-finish', offsetDays: null }]);
		const row = templateOutline(t).groups[0].tasks[0];
		expect(row.name).toBe('Task 10');
		expect(row.after[0].upstream).toBe('Task 777');
	});
});
