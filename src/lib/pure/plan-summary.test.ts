import { describe, expect, it } from 'vitest';
import { defaultRunOptions } from './entry';
import { matchKey } from './matching';
import { planEntity, withFieldPolicy } from './planner';
import { acceptPicks, withExtraAction } from './plan-view';
import {
	OUTCOME_MEANING,
	OUTCOME_ORDER,
	outcomeMeaning,
	entitySummary,
	fieldLabel,
	matchesKey,
	planSummary,
	policyChoice,
	taskLines,
	type SummaryInput
} from './plan-summary';
import type { Edge, EntityPlan, EntitySnapshot, EntityTask, ProjectContext, RunOptions, Template, TemplateTask } from './types';

const STEP = { type: 'Step', id: 11, name: 'Anim' };

const ctx = (): ProjectContext => ({
	project: { type: 'Project', id: 1180 },
	defaultTaskStatus: 'wtg',
	validTaskStatuses: ['wtg', 'ip', 'omt']
});

function task(id: number, content: string, extra: Partial<EntityTask> = {}): EntityTask {
	return {
		id,
		content,
		step: STEP,
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
		fields: { content, step: 11 },
		entity: { type: 'Shot', id: 1, name: 'sh010' },
		templateTask: null,
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-01T00:00:00Z',
		...extra
	};
}

function tplTask(id: number, content: string, extra: Partial<TemplateTask> = {}): TemplateTask {
	const { entity: _e, templateTask: _t, pinned: _p, dependencyViolation: _d, createdAt: _c, ...core } = task(id, content);
	return { ...core, templateId: 5, ...extra };
}

const edge = (id: number | null, upstream: number, downstream: number): Edge => ({
	id,
	upstream,
	downstream,
	type: 'finish-to-start-next-day',
	offsetDays: null
});

// Layout -> Anim -> Comp; Comp has a description; Review stands alone.
const template: Template = {
	id: 5,
	code: 'TT Seed · Shot v2',
	entityType: 'Shot',
	tasks: [
		tplTask(100, 'Layout', { startDate: '2026-10-01', dueDate: '2026-10-03' }),
		tplTask(101, 'Anim'),
		tplTask(102, 'Comp', { description: 'Final comp', fields: { content: 'Comp', step: 11, sg_description: 'Final comp' } }),
		tplTask(103, 'Review', { startDate: '2026-10-10', dueDate: '2026-10-11' })
	],
	edges: [edge(900, 100, 101), edge(901, 101, 102)]
};
const linked = (id: number, name: string) => ({ templateTask: { id, name, templateId: 5 } });

const snap = (id: number, name: string, tasks: EntityTask[], extra: Partial<EntitySnapshot> = {}): EntitySnapshot => ({
	entity: { type: 'Shot', id, name, entityType: 'Shot', taskTemplate: null },
	tasks: tasks.map((t) => ({ ...t, entity: { type: 'Shot', id, name } })),
	edges: [],
	usage: {},
	readAt: '2026-09-24T00:00:00Z',
	...extra
});

const opts0 = (): RunOptions => defaultRunOptions(ctx());
const plan = (s: EntitySnapshot, o: RunOptions = opts0(), t: Template = template) => planEntity(t, s, ctx(), o);

// Claims (one with an old link), creates, and two extras; a hand edge Paint -> Anim (109).
const extraSnap = snap(
	2,
	'tts_extras',
	[
		task(10, 'Anim', { templateTask: { id: 700, name: 'Anim', templateId: 4 } }),
		task(11, 'Paint'),
		task(12, 'Layout'),
		task(13, 'Grade')
	],
	{ edges: [edge(950, 11, 10)], usage: { 11: { versions: 2, publishedFiles: 3 } } }
);
// Two "Comp" Tasks; the one with a Version wins the pre-pick.
const conflictSnap = snap(1, 'tts_cf_pubs', [task(1, 'Comp'), task(2, 'comp ')], { usage: { 2: { versions: 1, publishedFiles: 0 } } });

const input = (plans: EntityPlan[], options: RunOptions = opts0(), extra: Partial<SummaryInput> = {}): SummaryInput => ({
	plans,
	options,
	template,
	templates: [template, { id: 4, code: 'TT Seed · Shot v1', entityType: 'Shot', tasks: [], edges: [] }],
	tasks: {},
	entityType: 'Shot',
	...extra
});

const byTask = (lines: ReturnType<typeof taskLines>, taskId: number) => lines.find((l) => l.taskId === taskId)!;

describe('taskLines: one outcome per Task', () => {
	it('labels claims linked, missing template tasks created, extras left alone', () => {
		const p = plan(extraSnap);
		const lines = taskLines(p, input([p]));
		expect(byTask(lines, 10).outcome).toBe('linked');
		expect(byTask(lines, 12).outcome).toBe('linked');
		expect(byTask(lines, 11).outcome).toBe('left');
		expect(byTask(lines, 13).outcome).toBe('left');
		const created = lines.filter((l) => l.outcome === 'created');
		expect(created.map((l) => l.name)).toEqual(['Comp', 'Review']);
		expect(created.every((l) => l.taskId === null && l.templateTaskId !== null)).toBe(true);
	});

	it('says where a claimed Task was linked before, and what it is linked to now', () => {
		const p = plan(extraSnap);
		const anim = byTask(taskLines(p, input([p])), 10);
		expect(anim.details.map((d) => d.text)).toContain('Linked before: Anim in TT Seed · Shot v1.');
		expect(anim.details[0].text).toBe('Same name and Step: linked to Anim in TT Seed · Shot v2.');
	});

	it('marks filled dates, and a Task downstream of a new dependency whose dates may move (092)', () => {
		const p = plan(extraSnap);
		const lines = taskLines(p, input([p]));
		expect(byTask(lines, 12).markers.map((m) => m.key)).toContain('dates_filled');
		expect(byTask(lines, 10).markers.map((m) => m.key)).toContain('dates_move');
		expect(byTask(lines, 10).details.map((d) => d.text)).toContain('New dependency: after Layout #12.');
	});

	it('names the dropped hand edge on its downstream Task, with what happens to it', () => {
		const p = plan(extraSnap);
		const anim = byTask(taskLines(p, input([p])), 10);
		expect(anim.details.map((d) => d.text)).toContain(
			'Dependency after Paint #11: the apply removes it (its upstream is not in the template); re-created after the apply.'
		);
	});

	it('shows template dates on created Tasks, or that they are cleared (097)', () => {
		const p = plan(extraSnap);
		const review = taskLines(p, input([p])).find((l) => l.name === 'Review')!;
		expect(review.details.map((d) => d.text)).toContain('Template dates: 2026-10-10 to 2026-10-11.');
		const o = { ...opts0(), clearCreatedDates: true };
		const q = plan(extraSnap, o);
		const cleared = taskLines(q, input([q], o)).find((l) => l.name === 'Review')!;
		expect(cleared.details.map((d) => d.text)).toContain('Template dates cleared.');
	});

	it('omit and delete label the extra, deletes with publishes loudly (089)', () => {
		const o = withExtraAction(withExtraAction(opts0(), 11, 'delete'), 13, 'omit');
		const p = plan(extraSnap, o);
		const lines = taskLines(p, input([p], o));
		const paint = byTask(lines, 11);
		expect(paint.outcome).toBe('deleted');
		expect(paint.markers).toContainEqual({ key: 'usage', label: '2 Versions, 3 Published Files', tone: 'destructive' });
		expect(paint.details.map((d) => d.text)).toContain(
			'Deleted. Its 2 Versions and 3 Published Files are orphaned; undo revives it.'
		);
		const one = { ...extraSnap, usage: { 11: { versions: 1, publishedFiles: 1 } } };
		const single = byTask(taskLines(plan(one, o), input([plan(one, o)], o)), 11);
		expect(single.markers).toContainEqual({ key: 'usage', label: '1 Version, 1 Published File', tone: 'destructive' });
		expect(single.details.map((d) => d.text)).toContain('Deleted. Its 1 Version and 1 Published File are orphaned; undo revives it.');
		expect(byTask(lines, 13).outcome).toBe('omitted');
		expect(byTask(lines, 13).details.map((d) => d.text)).toEqual(['Not in the template.', 'Status wtg becomes omt.']);
		const names = { wtg: 'Waiting to Start', omt: 'Omitted' };
		const named = byTask(taskLines(p, input([p], o, { statusNames: names })), 13);
		expect(named.details.map((d) => d.text)).toContain('Status Waiting to Start becomes Omitted.');
	});

	it('a Task not in the template reads as sentences: why, then what happens', () => {
		const p = plan(extraSnap);
		expect(byTask(taskLines(p, input([p])), 13).details.map((d) => d.text)).toEqual(['Not in the template.', 'Left as it is.']);
		const o = withExtraAction(opts0(), 13, 'delete');
		const q = plan(extraSnap, o);
		expect(byTask(taskLines(q, input([q], o)), 13).details.map((d) => d.text)).toEqual(['Not in the template.', 'Deleted; undo revives it.']);
	});

	it('an edge on a Task set to delete is removed with it, on both ends, never offered keep (103)', () => {
		const o = withExtraAction(opts0(), 11, 'delete');
		const p = plan(extraSnap, o);
		expect(p.edges.affected).toEqual([]);
		const lines = taskLines(p, input([p], o));
		expect(byTask(lines, 10).details.map((d) => d.text)).toContain('Anim #10 after Paint #11: removed with Paint #11, which is deleted.');
		expect(byTask(lines, 11).details.map((d) => d.text)).toContain('Anim #10 after Paint #11: removed with this Task.');
		const s = planSummary(input([p], o));
		expect(s.lines.find((l) => l.key === 'deps_removed')!.text).toBe('1 dependency removed');
		expect(s.lines.find((l) => l.key === 'deps_recreated')).toBeUndefined();
	});

	it('a linked Task with nothing to change is unchanged; renamed back by hand is updated, loudly', () => {
		const s = snap(3, 'tts_keep', [task(20, 'Anim', linked(101, 'Anim')), task(21, 'Layout v2', { ...linked(100, 'Layout'), key: matchKey('Layout v2', 11) })]);
		const p = plan(s);
		const lines = taskLines(p, input([p]));
		expect(byTask(lines, 20).outcome).toBe('unchanged');
		const hand = byTask(lines, 21);
		expect(hand.outcome).toBe('updated');
		expect(hand.markers).toContainEqual({ key: 'renamed', label: 'renamed back', tone: 'warning' });
		expect(hand.details.map((d) => d.text)).toContain("Renamed by hand. Renamed back to the template's name: Layout v2 to Layout.");
	});

	it('a claim that takes the template name is linked + renamed', () => {
		const s = snap(4, 'tts_case', [task(30, 'anim')]);
		const p = plan(s);
		const line = byTask(taskLines(p, input([p])), 30);
		expect(line.outcome).toBe('linked_renamed');
		expect(line.details.map((d) => d.text)).toContain('Renamed: anim to Anim.');
	});

	it('field changes use display names; kept values say so, overwritten ones mark the Task', () => {
		const s = snap(5, 'tts_fields', [task(40, 'Comp', { ...linked(102, 'Comp'), description: 'mine', fields: { content: 'Comp', step: 11, sg_description: 'mine' } })]);
		const labels = { sg_description: 'Description' };
		const p = plan(s);
		const kept = byTask(taskLines(p, input([p], opts0(), { labels })), 40);
		expect(kept.outcome).toBe('unchanged');
		expect(kept.details.map((d) => d.text)).toContain('Description: yours kept (mine; the template has Final comp).');
		const o = withFieldPolicy(opts0(), 'sg_description', 'overwrite');
		const q = plan(s, o);
		const over = byTask(taskLines(q, input([q], o, { labels })), 40);
		expect(over.outcome).toBe('updated');
		expect(over.markers.map((m) => m.key)).toContain('fields');
		expect(over.details.map((d) => d.text)).toContain("Description: mine becomes Final comp (the template's).");
	});
});

describe('taskLines: conflicts', () => {
	it('an unresolved conflict is one needs-a-choice line; its candidates are not listed apart', () => {
		const p = plan(conflictSnap);
		const lines = taskLines(p, input([p]));
		const choice = lines.filter((l) => l.outcome === 'needs_choice');
		expect(choice).toHaveLength(1);
		expect(choice[0].conflict?.candidates.map((c) => c.task.id)).toEqual([2, 1]);
		expect(choice[0].name).toBe('Comp');
		expect(choice[0].details.map((d) => d.text)).toEqual(['2 Tasks are named Comp on Step Anim: pick the one to link, or create a new one.']);
		expect(lines.some((l) => l.taskId === 1 || l.taskId === 2)).toBe(false);
	});

	it('once picked, the conflict resolves to linked and left alone, the picker kept in the fold', () => {
		const o = acceptPicks(opts0(), [plan(conflictSnap)]);
		const p = plan(conflictSnap, o);
		const lines = taskLines(p, input([p], o));
		expect(lines.some((l) => l.outcome === 'needs_choice')).toBe(false);
		expect(byTask(lines, 2).outcome).toBe('linked_renamed');
		expect(byTask(lines, 2).conflict).not.toBeNull();
		expect(byTask(lines, 1).outcome).toBe('left');
		expect(byTask(lines, 1).conflict).not.toBeNull();
		expect(byTask(lines, 1).details.map((d) => d.text)).toEqual(['Another Task was picked for Comp.', 'Left as it is.']);
		expect(byTask(lines, 2).details.map((d) => d.text)).toContain('Picked from 2 Tasks with this name and Step.');
	});
});

describe('entitySummary', () => {
	it('groups the Tasks by outcome, needs a choice first, and sums them in one line', () => {
		const p = plan(conflictSnap);
		const s = entitySummary(p, input([p]));
		expect(s.groups.map((g) => g.outcome)).toEqual(['needs_choice', 'created']);
		expect(s.line).toBe('3 created, 1 needs a choice');
		expect(OUTCOME_ORDER[0]).toBe('needs_choice');
	});

	it('names the run\'s entity type in the created group\'s meaning, the entity when none is known', () => {
		const p = plan(conflictSnap);
		const created = (entityType: string | null) => entitySummary(p, input([p], opts0(), { entityType })).groups.find((g) => g.outcome === 'created')?.meaning;
		expect(created('Shot')).toBe('missing on the Shot, created from the template');
		expect(created(null)).toBe('missing on the entity, created from the template');
		expect(outcomeMeaning('linked', 'Shot')).toBe(OUTCOME_MEANING.linked);
		expect(outcomeMeaning('deleted', 'Shot', 1)).toBe('not in the template, deleted; undo revives it');
		expect(outcomeMeaning('deleted', 'Shot', 2)).toBe('not in the template, deleted; undo revives them');
	});

	it('says so when there is nothing to write', () => {
		const s0 = snap(6, 'tts_same', [task(50, 'Layout', { ...linked(100, 'Layout'), startDate: '2026-10-01', dueDate: '2026-10-03' })]);
		const one: Template = { ...template, tasks: [template.tasks[0]], edges: [] };
		const s = { ...s0, entity: { ...s0.entity, taskTemplate: { type: 'TaskTemplate', id: 5 } } };
		const p = plan(s, opts0(), one);
		expect(p.noop).toBe(true);
		const e = entitySummary(p, input([p], opts0(), { template: one }));
		expect(e.line).toBe('Nothing to write · 1 already linked');
		expect(e.tally.noop).toBe(1);
	});

	it('a claim-heavy entity reads linked, created, not in template', () => {
		const p = plan(extraSnap);
		expect(entitySummary(p, input([p])).line).toBe('2 linked, 2 created, 2 not in template');
	});
});

describe('planSummary: the run summary', () => {
	it('says what Apply does, in plain sentences with counts and where', () => {
		const a = plan(extraSnap);
		const b = plan(conflictSnap);
		const s = planSummary(input([a, b]));
		const text = Object.fromEntries(s.lines.map((l) => [l.key, `${l.text}${l.where ? `, ${l.where}` : ''}`]));
		expect(text.needs_choice).toBeUndefined(); // said once, in the Before Apply notice
		expect(text.created).toBe('5 new Tasks created from the template, on both Shots');
		expect(text.linked).toBe('2 existing Tasks matched by name and Step, linked to the template, on 1 of 2 Shots');
		expect(text.left).toBe('2 Tasks not in the template, not changed, on 1 of 2 Shots');
		expect(text.deps_added).toBe('4 dependencies added, on both Shots');
		expect(text.deps_recreated).toBe('1 dependency removed by the apply, re-created after it, on 1 of 2 Shots');
		expect(s.lines.every((l) => l.count > 0)).toBe(true);
	});

	it('the fields line says whose values win, by display name', () => {
		const a = plan(extraSnap);
		const s = planSummary(input([a], opts0(), { labels: { content: 'Task Name', sg_description: 'Description' } }));
		const line = s.lines.find((l) => l.key === 'policy')!;
		expect(line.text).toBe("3 template fields on 2 existing Tasks: your values kept, except Task Name (the template's)");
		const o = withFieldPolicy(opts0(), 'content', 'keep');
		const t = planSummary(input([plan(extraSnap, o)], o, { labels: { content: 'Task Name' } }));
		expect(t.lines.find((l) => l.key === 'policy')!.text).toBe('3 template fields on 2 existing Tasks: your values kept');
	});

	it('names deletes with publishes', () => {
		const o = withExtraAction(opts0(), 11, 'delete');
		const s = planSummary(input([plan(extraSnap, o)], o));
		expect(s.lines.find((l) => l.key === 'deleted')!.text).toBe('1 Task deleted, 1 with Versions or Published Files');
	});

	it('each line filters the entities it counts', () => {
		const a = plan(extraSnap);
		const b = plan(conflictSnap);
		const s = planSummary(input([a, b]));
		expect(matchesKey(s.entities[2], 'linked')).toBe(true);
		expect(matchesKey(s.entities[1], 'linked')).toBe(false);
		expect(matchesKey(s.entities[1], 'needs_choice')).toBe(true);
		expect(matchesKey(s.entities[1], null)).toBe(true);
	});
});

describe('field names and policy words', () => {
	it('uses the display name, the code name when there is none', () => {
		expect(fieldLabel({ sg_description: 'Description' }, 'sg_description')).toBe('Description');
		expect(fieldLabel({}, 'sg_priority_1')).toBe('sg_priority_1');
		expect(fieldLabel(undefined, 'est_in_mins')).toBe('est_in_mins');
	});

	it('says each policy in plain words', () => {
		expect(policyChoice('keep')).toEqual({ short: 'Yours', long: 'yours, written back after the apply' });
		expect(policyChoice('overwrite')).toEqual({ short: "Template's", long: "the template's" });
		expect(policyChoice('fill_if_empty')).toEqual({ short: "Template's if empty", long: "the template's, only where yours is empty" });
	});
});
