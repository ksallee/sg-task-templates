import { describe, expect, it } from 'vitest';

import expectations from '../../../fixtures/seed-expectations.json';
import manifest from '../../../fixtures/seed-manifest.json';
import { planEntity } from './planner';
import { edgeFromRow, taskFromRow, templateFromRows, usageFromRows } from './read';
import type { EntityPlan, EntityRow, EntitySnapshot, Id, ProjectContext, RunOptions, Template } from './types';

/*
 * The seed's expected plans (tools/_plan.py, fixtures/seed-expectations.json) against the app's own
 * planner, on the snapshot the seed read back from the sandbox (fixtures/seed-manifest.json). Two
 * implementations of one set of rules: where they part, one of them is wrong.
 *
 * Template tasks are not in the manifest's snapshot: they are built from the seed's spec
 * (`templates` in the expectations) with the manifest's ids and read-back rules (083: a milestone
 * reads duration 0). Step ids come from the manifest's Tasks; a step no seeded Task uses gets a
 * negative id, which matches nothing, as on the site. Generated Tasks' `created_at` is the
 * scenario's `seeded_at` (the seed does not send one); hand Tasks' is the seed's (070).
 */

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const M: Json = manifest;
const X: Json = expectations;

const ctx: ProjectContext = {
	project: { type: 'Project', id: M.project },
	defaultTaskStatus: M.default_status,
	validTaskStatuses: []
};

const opts: RunOptions = {
	fieldPolicies: {},
	extraByName: {},
	extraOverrides: {},
	omitStatus: 'omt',
	conflictPicks: {},
	edgeActions: {},
	clearCreatedDates: false,
	deleteConfirmed: false
};

const ref = (type: string, id: Id | null) => (id === null ? null : { type, id });
const people = (roles: string[]) => roles.map((r) => ({ type: 'HumanUser', id: M.people[r] }));

// -- step ids: "<name>|<entity type>" -> id, from the manifest's seeded Tasks ---------------------

const stepIds = new Map<string, Id>();
for (const [sid, sc] of Object.entries<Json>(M.scenarios)) {
	for (const [code, ent] of Object.entries<Json>(sc.entities)) {
		const snap = sc.snapshot[String(ent.id)];
		for (const [label, taskId] of Object.entries<Json>(ent.tasks)) {
			const stepId = snap.tasks[String(taskId)]?.step;
			if (stepId == null) continue;
			const step: [string, string] | null = label.startsWith('hand:')
				? X.hands[sid][code][label].step
				: [label.slice(label.lastIndexOf('@') + 1), ent.type];
			if (step) stepIds.set(step.join('|'), stepId);
		}
	}
}
let unknownStep = 0;
function stepId(step: [string, string] | null): Id | null {
	if (!step) return null;
	const k = step.join('|');
	if (!stepIds.has(k)) stepIds.set(k, --unknownStep);
	return stepIds.get(k)!;
}

// -- templates: seed spec + manifest ids -> wire rows -> read.ts ------------------------------------

const templateIdOf = new Map<Id, Id>(); // template task id -> template id
function template(key: string): Template {
	const spec = X.templates[key];
	const man = M.templates[key];
	const taskRows: EntityRow[] = spec.tasks.map((t: Json) => {
		const id = man.tasks[t.label];
		templateIdOf.set(id, man.id);
		return {
			type: 'Task',
			id,
			attributes: {
				content: t.content,
				sg_sort_order: t.sg_sort_order,
				duration: t.milestone ? 0 : t.duration, // 083: a milestone reads duration 0
				est_in_mins: t.est_in_mins,
				sg_description: t.sg_description,
				milestone: t.milestone,
				start_date: t.start_date,
				due_date: t.due_date,
				sg_status_list: null
			},
			relationships: {
				step: { data: ref('Step', stepId(t.step)) },
				task_template: { data: { type: 'TaskTemplate', id: man.id } },
				project: { data: null },
				task_assignees: { data: people(t.task_assignees) },
				task_reviewers: { data: people(t.task_reviewers) }
			}
		} as EntityRow;
	});
	const depRows: EntityRow[] = spec.edges.map((e: Json) => ({
		type: 'TaskDependency',
		id: man.edges[`${e.up} > ${e.down}`],
		attributes: {
			dependency_type: e.type,
			offset_days: e.offset,
			task_id: man.tasks[e.down],
			dependent_task_id: man.tasks[e.up]
		},
		relationships: {}
	}));
	const row = {
		type: 'TaskTemplate',
		id: man.id,
		attributes: { code: man.code, entity_type: spec.entity_type },
		relationships: {}
	} as EntityRow;
	return templateFromRows(row, taskRows, depRows);
}
const templates = Object.fromEntries(Object.keys(X.templates).map((k) => [k, template(k)]));

// -- entities: manifest snapshot -> wire rows -> read.ts ---------------------------------------------

function snapshot(sid: string, code: string): { snap: EntitySnapshot; labels: Map<Id, string> } {
	const sc = M.scenarios[sid];
	const ent = sc.entities[code];
	const s = sc.snapshot[String(ent.id)];
	const labels = new Map<Id, string>(Object.entries<Id>(ent.tasks).map(([l, id]) => [id, l]));
	const entity = { type: ent.type, id: ent.id };
	const tasks = Object.entries<Json>(s.tasks).map(([id, t]) => {
		const label = labels.get(Number(id))!;
		const createdAt = label.startsWith('hand:') ? X.hands[sid][code][label].created_at : sc.seeded_at;
		return taskFromRow(
			{
				type: 'Task',
				id: Number(id),
				attributes: {
					content: t.content,
					sg_status_list: t.status,
					sg_sort_order: t.sg_sort_order,
					duration: t.duration,
					est_in_mins: t.est_in_mins,
					sg_description: t.sg_description,
					milestone: t.milestone,
					start_date: t.start_date,
					due_date: t.due_date,
					pinned: t.pinned,
					dependency_violation: t.dependency_violation,
					created_at: createdAt
				},
				relationships: {
					entity: { data: entity },
					step: { data: ref('Step', t.step) },
					template_task: { data: ref('Task', t.template_task) },
					task_assignees: { data: t.task_assignees.map((id: Id) => ({ type: 'HumanUser', id })) },
					task_reviewers: { data: t.task_reviewers.map((id: Id) => ({ type: 'HumanUser', id })) }
				}
			} as EntityRow,
			(ttId) => templateIdOf.get(ttId) ?? null
		);
	});
	let n = 0;
	const edges = s.edges.map(([up, down, type, offset]: Json) =>
		edgeFromRow({
			type: 'TaskDependency',
			id: ++n, // the snapshot keeps no edge ids; any unique id will do
			attributes: { dependency_type: type, offset_days: offset, task_id: down, dependent_task_id: up },
			relationships: {}
		} as EntityRow)
	);
	const usage = usageFromRows(
		s.versions.map(([id, task]: [Id, Id]) => ({ type: 'Version', id, relationships: { sg_task: { data: ref('Task', task) } } })),
		s.pfs.map(([id, task]: [Id, Id]) => ({ type: 'PublishedFile', id, relationships: { task: { data: ref('Task', task) } } }))
	);
	const taskTemplate = s.task_template === null ? null : { type: 'TaskTemplate', id: s.task_template };
	return {
		snap: { entity: { ...entity, entityType: ent.type, taskTemplate }, tasks, edges, usage, readAt: sc.seeded_at },
		labels
	};
}

// -- what the expectations name, read off an EntityPlan ------------------------------------------------

function view(plan: EntityPlan, labels: Map<Id, string>, tplLabels: Map<Id, string>) {
	const task = (id: Id) => labels.get(id) ?? `?${id}`;
	const conflicts = plan.rows.flatMap((r) =>
		r.kind === 'conflict'
			? [
					{
						template_tasks: r.templateTasks.map((t) => tplLabels.get(t.id)),
						candidates: r.candidates.map((c) => task(c.task.id)).sort(),
						prepick: Object.values(r.prePick).map(task),
						reason: r.reason
					}
				]
			: []
	);
	const extras = plan.rows.flatMap((r) => (r.kind === 'extra' ? [{ task: task(r.task.id), reason: r.reason }] : []));
	const renames = plan.rows.flatMap((r) =>
		(r.kind === 'keep' || r.kind === 'claim') && r.rename
			? [{ task: task(r.task.id), from: r.rename.from, to: r.rename.to, hand_renamed: r.rename.handRenamed }]
			: []
	);
	const fields = plan.rows.flatMap((r) =>
		r.kind === 'keep' || r.kind === 'claim'
			? r.fieldChanges
					.filter((c) => c.field !== 'content')
					.map((c) => ({ task: task(r.task.id), field: c.field }))
			: []
	);
	const e = plan.edges;
	const edgeCounts = {
		same: 0, // not reported by edges.ts
		replaced: e.affected.filter((a) => a.cause === 'replaced').length,
		removed: e.affected.filter((a) => a.cause === 'not_in_template').length,
		outside_upstream: e.affected.filter((a) => a.cause === 'outside_upstream').length,
		kept: e.toExtras.length,
		untouched: e.untouched?.length ?? 0,
		added: e.expectedAdded.length,
		closes_loop: e.affected.filter((a) => a.closesLoop).length
	};
	return { counts: plan.counts, conflicts, extras, renames, fields, edgeCounts };
}

// -- the cases ------------------------------------------------------------------------------------

const cases: Array<[string, string]> = [];
for (const [sid, sc] of Object.entries<Json>(X.scenarios)) {
	if (!M.scenarios[sid]) continue;
	for (const code of Object.keys(sc.entities)) cases.push([sid, code]);
}

function run(sid: string, code: string) {
	const key: string = X.scenarios[sid].apply;
	const tpl = templates[key];
	const { snap, labels } = snapshot(sid, code);
	const tplLabels = new Map<Id, string>(Object.entries<Id>(M.templates[key].tasks).map(([l, id]) => [id, l]));
	return { plan: planEntity(tpl, snap, ctx, opts), labels, tplLabels, want: X.scenarios[sid].entities[code] };
}

describe('seed expectations agree with the planner on the seeded snapshot', () => {
	it('covers every seeded scenario entity', () => {
		expect(cases.length).toBe(55);
	});

	it.each(cases)('%s %s: the five counts', (sid, code) => {
		const { plan, want } = run(sid, code);
		expect(plan.counts).toEqual(want.counts);
	});

	it.each(cases)('%s %s: conflicts, extras, renames and fields', (sid, code) => {
		const { plan, labels, tplLabels, want } = run(sid, code);
		const got = view(plan, labels, tplLabels);
		expect(got.conflicts).toEqual(
			want.conflicts.map((c: Json) => ({
				template_tasks: c.template_tasks,
				candidates: [...c.candidates].sort(),
				prepick: c.prepick,
				reason: c.reason
			}))
		);
		const byTask = (a: { task: string }, b: { task: string }) => a.task.localeCompare(b.task);
		expect(got.extras.sort(byTask)).toEqual(
			want.extras.map((x: Json) => ({ task: x.task, reason: x.reason })).sort(byTask)
		);
		expect(got.renames).toEqual(want.renames);
		expect(got.fields).toEqual(want.fields.map((f: Json) => ({ task: f.task, field: f.field })));
	});

	it.each(cases)('%s %s: edge counts', (sid, code) => {
		const { plan, labels, tplLabels } = run(sid, code);
		const want = X.scenarios[sid].entities[code].edges.counts;
		const got = view(plan, labels, tplLabels).edgeCounts;
		expect({ ...got, same: want.same }).toEqual(want);
	});
});
