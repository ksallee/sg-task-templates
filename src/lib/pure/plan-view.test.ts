import { describe, expect, it } from 'vitest';
import { defaultRunOptions } from './entry';
import { matchKey } from './matching';
import { planEntity } from './planner';
import { dependencyPhrase, offsetLabel } from './outline';
import {
	NO_FILTER,
	acceptPicks,
	accessWarningText,
	applyBlockers,
	clearableCreates,
	conflictResolved,
	edgeView,
	entityWarnings,
	fillLabels,
	filterPlans,
	groupRows,
	keyLabel,
	omitChoice,
	pendingDeletes,
	planCsvName,
	policyFieldViews,
	policySummary,
	extrasSummary,
	previousLinkLabel,
	unresolvedConflicts,
	valueLabel,
	withDeleteConfirmed,
	withEdgeAction,
	withExtraAction,
	withExtraNameAction
} from './plan-view';
import type { ConflictRow, Edge, EntitySnapshot, EntityTask, ProjectContext, RunOptions, Template, TemplateTask } from './types';

const STEP = { type: 'Step', id: 11, name: 'Anim' };

const ctx = (statuses = ['wtg', 'ip', 'omt']): ProjectContext => ({
	project: { type: 'Project', id: 1180 },
	defaultTaskStatus: 'wtg',
	validTaskStatuses: statuses
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

const edge = (id: number | null, upstream: number, downstream: number, extra: Partial<Edge> = {}): Edge => ({
	id,
	upstream,
	downstream,
	type: 'finish-to-start-next-day',
	offsetDays: null,
	...extra
});

// Template: Layout -> Anim -> Comp; Comp has sg_description; milestone on Review.
const template: Template = {
	id: 5,
	code: 'TT Seed · Shot v2',
	entityType: 'Shot',
	tasks: [
		tplTask(100, 'Layout', { startDate: '2026-10-01', dueDate: '2026-10-03' }),
		tplTask(101, 'Anim'),
		tplTask(102, 'Comp', { description: 'Final comp', fields: { content: 'Comp', step: 11, sg_description: 'Final comp' } }),
		tplTask(103, 'Review', { milestone: true, fields: { content: 'Review', step: 11, milestone: true } })
	],
	edges: [edge(900, 100, 101), edge(901, 101, 102)]
};

const snap = (id: number, name: string, tasks: EntityTask[], extra: Partial<EntitySnapshot> = {}): EntitySnapshot => ({
	entity: { type: 'Shot', id, name, entityType: 'Shot', taskTemplate: null },
	tasks: tasks.map((t) => ({ ...t, entity: { type: 'Shot', id, name } })),
	edges: [],
	usage: {},
	readAt: '2026-09-24T00:00:00Z',
	...extra
});

const opts0 = (): RunOptions => defaultRunOptions(ctx());

// A conflict: two "Comp" Tasks; the one with a Version wins the pre-pick.
const conflictSnap = snap(1, 'tts_cf_pubs', [task(1, 'Comp'), task(2, 'comp ')], { usage: { 2: { versions: 1, publishedFiles: 0 } } });
// A claim with an old link, an extra "Paint" and a hand edge Paint -> Anim (outside upstream, 109).
const extraSnap = snap(
	2,
	'tts_extras',
	[
		task(10, 'Anim', { templateTask: { id: 700, name: 'Anim', templateId: 4 } }),
		task(11, 'Paint'),
		task(12, 'Layout'),
		task(13, 'Grade')
	],
	{ edges: [edge(950, 11, 10), edge(951, 10, 13)], usage: { 11: { versions: 2, publishedFiles: 3 } } }
);
const plan = (s: EntitySnapshot, o: RunOptions = opts0(), t: Template = template) => planEntity(t, s, ctx(), o);

describe('conflicts', () => {
	it('is unresolved until every template task of it has a pick, then acceptPicks takes the shown pick', () => {
		const p = plan(conflictSnap);
		const row = p.rows.find((r): r is ConflictRow => r.kind === 'conflict')!;
		expect(conflictResolved(row, opts0(), 1)).toBe(false);
		expect(unresolvedConflicts(p, opts0())).toBe(1);
		const accepted = acceptPicks(opts0(), [p]);
		expect(accepted.entityConflictPicks).toEqual({ 1: { 102: 2 } });
		expect(unresolvedConflicts(plan(conflictSnap, accepted), accepted)).toBe(0);
	});

	it('accepts each entity its own pick: template task ids repeat across entities', () => {
		// Same conflict on a second entity, where the other Task holds the Version.
		const twin = snap(3, 'tts_cf_twin', [task(31, 'Comp'), task(32, 'comp')], { usage: { 31: { versions: 1, publishedFiles: 0 } } });
		const accepted = acceptPicks(opts0(), [plan(conflictSnap), plan(twin)]);
		expect(accepted.entityConflictPicks).toEqual({ 1: { 102: 2 }, 3: { 102: 31 } });
		expect(unresolvedConflicts(plan(twin, accepted), accepted)).toBe(0);
		expect(unresolvedConflicts(plan(conflictSnap, accepted), accepted)).toBe(0);
	});

	it('a run-wide or per-entity pick resolves it too', () => {
		const o = { ...opts0(), conflictPicks: { 102: 1 } };
		expect(unresolvedConflicts(plan(conflictSnap, o), o)).toBe(0);
		const e = { ...opts0(), entityConflictPicks: { 1: { 102: null } } };
		expect(unresolvedConflicts(plan(conflictSnap, e), e)).toBe(0);
	});
});

describe('extra actions', () => {
	it('a per-Task action withdraws the delete confirmation', () => {
		const o = withExtraAction(withDeleteConfirmed(opts0(), true), 11, 'delete');
		expect(o.extraOverrides[11]).toBe('delete');
		expect(o.deleteConfirmed).toBe(false);
	});

	it('a by-name action drops per-Task overrides of that name, so the bulk choice shows', () => {
		const p = plan(extraSnap);
		const o = withExtraNameAction(withExtraAction(opts0(), 11, 'omit'), 'paint', 'delete', [p]);
		expect(o.extraOverrides).toEqual({});
		expect(o.extraByName).toEqual({ paint: 'delete' });
		const row = plan(extraSnap, o).rows.find((r) => r.kind === 'extra' && r.task.id === 11);
		expect(row && row.kind === 'extra' && row.action).toBe('delete');
	});

	it('lists pending deletes with their usage, used ones first (089)', () => {
		const o = withExtraAction(withExtraAction(opts0(), 11, 'delete'), 1, 'delete');
		const a = plan(extraSnap, o);
		const b = plan(conflictSnap, acceptPicks(o, [plan(conflictSnap, o)]));
		const list = pendingDeletes([b, a]);
		expect(list.map((d) => d.task.id)).toEqual([11, 1]);
		expect(list[0].usage).toEqual({ versions: 2, publishedFiles: 3 });
	});
});

describe('policyFieldViews', () => {
	it('offers keep and overwrite on booleans, fill-if-empty elsewhere; content defaults to overwrite', () => {
		const views = policyFieldViews(template, opts0());
		const by = Object.fromEntries(views.map((v) => [v.field, v]));
		expect(by.content.policy).toBe('overwrite');
		expect(by.sg_description).toEqual({ field: 'sg_description', policy: 'keep', choices: ['keep', 'overwrite', 'fill_if_empty'] });
		expect(by.milestone.choices).toEqual(['keep', 'overwrite']);
	});

	it('offers no fill-if-empty on content and step: a name and a step are never empty', () => {
		const by = Object.fromEntries(policyFieldViews(template, opts0()).map((v) => [v.field, v]));
		expect(by.content.choices).toEqual(['keep', 'overwrite']);
		if (by.step) expect(by.step.choices).toEqual(['keep', 'overwrite']);
	});
});

describe('policySummary', () => {
	const v = (field: string, policy: 'keep' | 'overwrite' | 'fill_if_empty') => ({ field, policy, choices: [] });
	it('names the common policy, then each field that differs', () => {
		expect(policySummary([v('content', 'overwrite'), v('step', 'keep'), v('duration', 'keep')])).toBe('3 fields: keep · content: template name');
		expect(policySummary([v('content', 'keep'), v('step', 'overwrite'), v('duration', 'fill_if_empty'), v('est_in_mins', 'fill_if_empty')])).toBe(
			'4 fields: fill if empty · content: keep · step: template'
		);
	});
	it('says so when there is no field, and uses one field in the singular', () => {
		expect(policySummary([])).toBe('No field under policy');
		expect(policySummary([v('content', 'overwrite')])).toBe('1 field: content: template name');
	});
});

describe('extrasSummary', () => {
	it('counts the extra names, leave by default, then each name set otherwise', () => {
		const names = [{ name: 'retime', count: 5 }, { name: 'paint', count: 2 }, { name: 'roto', count: 1 }];
		expect(extrasSummary(names, opts0())).toBe('3 extra names: leave');
		expect(extrasSummary(names, { ...opts0(), extraByName: { retime: 'delete', paint: 'leave' } })).toBe('3 extra names: leave · retime: delete');
		expect(extrasSummary([{ name: '', count: 1 }], { ...opts0(), extraByName: { '': 'omit' } })).toBe('1 extra name: leave · (no name): omit');
		expect(extrasSummary([], opts0())).toBe('No extras');
	});
});

describe('omitChoice', () => {
	it('asks for a status only when the project has no omt', () => {
		expect(omitChoice(ctx(), opts0()).ask).toBe(false);
		const c = ctx(['wtg', 'ip', 'hld']);
		expect(omitChoice(c, defaultRunOptions(c))).toEqual({ ask: true, statuses: ['wtg', 'ip', 'hld'], current: '' });
	});
});

describe('clearableCreates', () => {
	it('counts created Tasks with no upstream edge and a template date (097)', () => {
		// Layout (dated, no upstream) is created on the conflict entity; Anim has an upstream edge.
		expect(clearableCreates([plan(conflictSnap)])).toBe(1);
		expect(clearableCreates([plan(extraSnap)])).toBe(0); // Layout is claimed there
	});
});

describe('applyBlockers', () => {
	it('names unresolved conflicts, refused access, a missing omit status, unconfirmed deletes', () => {
		const c = ctx(['wtg', 'ip']);
		let o = withExtraAction(withExtraAction(defaultRunOptions(c), 11, 'delete'), 12, 'omit');
		const plans = [planEntity(template, conflictSnap, c, o), planEntity(template, extraSnap, c, o)];
		const access = { checks: [], fields: { content: 'refused' as const }, looksShort: true };
		expect(applyBlockers(plans, o, c, access)).toEqual([
			'1 conflict to resolve.',
			'Write access looks refused.',
			'Confirm 1 delete.'
		]);
		o = withExtraAction(o, 11, 'omit');
		const again = [planEntity(template, extraSnap, c, o)];
		expect(applyBlockers(again, o, c, null)).toEqual(['Pick the status omitted Tasks take.']);
	});

	it('is empty once all is settled, and says so when every entity is a no-op', () => {
		const o = acceptPicks(opts0(), [plan(conflictSnap)]);
		expect(applyBlockers([plan(conflictSnap, o)], o, ctx(), null)).toEqual([]);
		const noop = { ...plan(conflictSnap, o), noop: true };
		expect(applyBlockers([noop], o, ctx(), null)).toEqual(['Nothing to write.']);
	});

	it('blocks a kept edge that closes a loop', () => {
		const p = plan(extraSnap);
		const loop = { ...p, edges: { ...p.edges, affected: p.edges.affected.map((a) => ({ ...a, closesLoop: true as const, action: 'keep' as const })) } };
		expect(applyBlockers([loop], opts0(), ctx(), null)).toContain('1 kept edge would close a loop: remove it.');
	});
});

describe('entityWarnings and filterPlans', () => {
	const mismatch: Template = { ...template, entityType: 'Asset' };

	it('shows the template type mismatch and open conflicts', () => {
		const codes = entityWarnings(plan(conflictSnap, opts0(), mismatch), opts0()).map((w) => [w.code, w.level]);
		expect(codes).toEqual([
			['template_entity_type_mismatch', 'warn'],
			['unresolved_conflict_row', 'block']
		]);
	});

	it('filters by count kind (any of), warnings, no-op and name', () => {
		const a = plan(conflictSnap);
		const b = plan(extraSnap);
		const o = opts0();
		expect(filterPlans([a, b], NO_FILTER, o)).toHaveLength(2);
		expect(filterPlans([a, b], { ...NO_FILTER, kinds: ['conflict'] }, o).map((p) => p.entity.id)).toEqual([1]);
		expect(filterPlans([a, b], { ...NO_FILTER, kinds: ['claim', 'conflict'] }, o)).toHaveLength(2);
		expect(filterPlans([a, b], { ...NO_FILTER, warnings: true }, o).map((p) => p.entity.id)).toEqual([1]);
		expect(filterPlans([a, { ...b, noop: true }], { ...NO_FILTER, noop: 'only' }, o).map((p) => p.entity.id)).toEqual([2]);
		expect(filterPlans([a, { ...b, noop: true }], { ...NO_FILTER, noop: 'hide' }, o).map((p) => p.entity.id)).toEqual([1]);
		expect(filterPlans([a, b], { ...NO_FILTER, text: 'EXTRA' }, o).map((p) => p.entity.id)).toEqual([2]);
	});
});

describe('edgeView', () => {
	it('names both ends, marks created ones, and lists outside-upstream and outside-downstream edges', () => {
		const p = plan(extraSnap);
		const v = edgeView(p, template, extraSnap.tasks);
		expect(v.added.map((e) => [e.upstream.label, e.downstream.label, e.downstream.created])).toEqual([
			['Layout #12', 'Anim #10', false],
			['Anim #10', 'Comp', true]
		]);
		expect(v.affected).toHaveLength(1);
		expect(v.affected[0]).toMatchObject({ id: 950, upstream: { label: 'Paint #11' }, cause: 'outside_upstream', action: 'keep', keepDisabled: null });
		expect(v.outsideDownstream.map((e) => e.downstream.label)).toEqual(['Grade #13']);
		expect(v.mayMove).toContain('Anim #10');
	});

	it('phrases each edge as the template outline does, from the downstream side', () => {
		const v = edgeView(plan(extraSnap), template, extraSnap.tasks);
		expect(v.added[0]).toMatchObject({ phrase: 'after', offset: null });
		expect(v.affected[0].phrase).toBe(dependencyPhrase(v.affected[0].type));
		expect(v.affected[0].offset).toBe(offsetLabel(v.affected[0].offsetDays));
	});

	it('disables keep with the reason on an edge that closes a loop (085, 107)', () => {
		const p = plan(extraSnap);
		const loop = { ...p, edges: { ...p.edges, affected: p.edges.affected.map((a) => ({ ...a, closesLoop: true as const, action: 'remove' as const })) } };
		expect(edgeView(loop, template, extraSnap.tasks).affected[0].keepDisabled).toMatch(/loop/);
	});

	it('edge actions go through the options', () => {
		expect(withEdgeAction(opts0(), 950, 'remove').edgeActions).toEqual({ 950: 'remove' });
	});
});

describe('labels', () => {
	it('keyLabel shows the normalized content and the step', () => {
		expect(keyLabel(matchKey('  Comp  Final ', 11), STEP)).toBe('comp final @ Anim');
		expect(keyLabel(matchKey('x', null), null)).toBe('x @ no step');
	});

	it('valueLabel prints refs by name and empties plainly', () => {
		expect(valueLabel(null)).toBe('(empty)');
		expect(valueLabel(true)).toBe('yes');
		expect(valueLabel([{ type: 'HumanUser', id: 1, name: 'Kevin' }])).toBe('Kevin');
		expect(valueLabel(1440)).toBe('1440');
	});

	it('previousLinkLabel names the old template when known', () => {
		const old: Template = { ...template, id: 4, code: 'TT Seed · Shot v1', tasks: [tplTask(700, 'Anim', { templateId: 4 })] };
		expect(previousLinkLabel({ id: 700, templateId: 4 }, [old])).toBe('Anim in TT Seed · Shot v1');
		expect(previousLinkLabel({ id: 701, name: 'Roto', templateId: null }, [])).toBe('Roto (#701)');
		expect(previousLinkLabel(null, [])).toBe('not linked');
	});

	it('groupRows splits rows by kind', () => {
		const g = groupRows(plan(extraSnap).rows);
		expect(g.claim.map((r) => r.task.id)).toEqual([12, 10]);
		expect(g.create.map((r) => r.templateTask.id)).toEqual([102, 103]);
		expect(g.extra.map((r) => r.task.id)).toEqual([11, 13]);
	});

	it('planCsvName', () => {
		expect(planCsvName('TT Seed · Shot v2', new Date('2026-09-24T10:00:00Z'))).toBe('plan-tt-seed-shot-v2-2026-09-24.csv');
	});

	it('accessWarningText names the refusals and carries 094 caveat', () => {
		const text = accessWarningText({
			checks: [{ capability: 'delete_task', result: 'refused', response: null }],
			fields: { sg_description: 'refused' },
			looksShort: true
		});
		expect(text).toMatch(/cannot delete Tasks; cannot write sg_description/);
		expect(text).toMatch(/094/);
		expect(accessWarningText({ checks: [], fields: {}, looksShort: false })).toBeNull();
	});
});

describe('fillLabels', () => {
	it('says what the apply fills from the template (102)', () => {
		expect(fillLabels(undefined)).toEqual([]);
		expect(
			fillLabels([
				{ field: 'task_assignees', value: [{ type: 'HumanUser', id: 517, name: 'Kevin' }] },
				{ field: 'start_date', value: '2026-03-02' },
				{ field: 'due_date', value: '2026-03-04' }
			])
		).toEqual([
			'Assignees will be filled from the template: Kevin.',
			'Dates will be filled from the template: 2026-03-02 to 2026-03-04; a dependency may move them.'
		]);
		expect(fillLabels([{ field: 'due_date', value: '2026-03-04' }])).toEqual([
			'Dates will be filled from the template: (empty) to 2026-03-04; a dependency may move them.'
		]);
	});
});
