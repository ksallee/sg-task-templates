/**
 * Entry: what the first screens decide before a plan exists. Which entities a list shows, which
 * templates a type offers, the template's edges as the template screen names them, the run's
 * starting options, and the sample the access check runs on. Pure, no I/O.
 */

import type { WireGroup } from 'sg-widgets-core';
import { nonEmptyPolicyFields } from './read';
import type {
	DependencyType,
	EntityPlan,
	EntitySnapshot,
	EntityTask,
	FieldName,
	Id,
	PlanKind,
	ProjectContext,
	Run,
	RunOptions,
	Template
} from './types';

/** Brief 1 and 5: pick entities then a template, a template then every entity using it, or entities with none. */
export type EntryPoint = Run['entryPoint'];

/**
 * The `_search` filter behind the entities list. `entities_first` lists the whole type in the project;
 * `template_first` those whose `task_template` is the template; `no_template` those with none (brief 5).
 * A non-blank search narrows on `code` with `contains`, which works on text fields (doors/findings-filter).
 */
export function entityListFilters(projectId: Id, entry: EntryPoint, templateId: Id | null, search: string): WireGroup {
	const conditions: WireGroup['conditions'] = [['project', 'is', { type: 'Project', id: projectId }]];
	if (entry === 'template_first' && templateId !== null) {
		conditions.push(['task_template', 'is', { type: 'TaskTemplate', id: templateId }]);
	}
	if (entry === 'no_template') conditions.push(['task_template', 'is', null]);
	const text = search.trim();
	if (text) conditions.push(['code', 'contains', text]);
	return { logical_operator: 'and', conditions };
}

const byCode = (a: Template, b: Template) => a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }) || a.id - b.id;

/**
 * The type's own templates, then the rest. A template's `entity_type` is not enforced (083): another
 * type's template is offered too, and the plan warns on the mismatch (brief 7).
 */
export function templatesByType(templates: Template[], entityType: string | null): { matching: Template[]; others: Template[] } {
	const matching = templates.filter((t) => entityType !== null && t.entityType === entityType).sort(byCode);
	const others = templates.filter((t) => entityType === null || t.entityType !== entityType).sort(byCode);
	return { matching, others };
}

export interface TemplateEdgeRow {
	id: Id | null;
	upstream: string;
	downstream: string;
	type: DependencyType;
	offsetDays: number | null;
}

/** The template's edges, each end named by its task's `content` (085: `task` downstream, `dependent_task` upstream). */
export function templateEdgeRows(template: Template): TemplateEdgeRow[] {
	const names = new Map(template.tasks.map((t) => [t.id, t.content ?? `Task ${t.id}`]));
	const name = (id: Id) => names.get(id) ?? `Task ${id}`;
	return template.edges.map((e) => ({
		id: e.id,
		upstream: name(e.upstream),
		downstream: name(e.downstream),
		type: e.type,
		offsetDays: e.offsetDays
	}));
}

/** `items` in runs of `size`, in order. */
export function chunk<T>(items: T[], size: number): T[][] {
	if (!(size >= 1)) throw new Error(`chunk: size must be at least 1, got ${size}`);
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** The stock Omit status code. Used only when the project lists it; otherwise the plan screen asks. */
const STOCK_OMIT = 'omt';

/**
 * A fresh run's options: every policy at its default (`policyFor`: keep, the name overwrite), every
 * extra left, pre-picks for conflicts, every affected edge kept, dates copied, no delete confirmed.
 * `omitStatus` is `omt` only when the project's Task statuses include it, else empty: never guessed.
 */
export function defaultRunOptions(ctx: ProjectContext): RunOptions {
	return {
		fieldPolicies: {},
		extraByName: {},
		extraOverrides: {},
		omitStatus: ctx.validTaskStatuses.includes(STOCK_OMIT) ? STOCK_OMIT : '',
		conflictPicks: {},
		edgeActions: {},
		clearCreatedDates: false,
		deleteConfirmed: false
	};
}

export type PlanTotals = Record<PlanKind, number> & { entities: number; noop: number };

/** The five counts summed over every entity, with how many entities have nothing to write. */
export function planTotals(plans: EntityPlan[]): PlanTotals {
	const out: PlanTotals = { entities: plans.length, noop: 0, keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 };
	for (const p of plans) {
		if (p.noop) out.noop++;
		for (const kind of ['keep', 'claim', 'create', 'extra', 'conflict'] as const) out[kind] += p.counts[kind];
	}
	return out;
}

export interface AccessSample {
	task: EntityTask;
	entity: EntitySnapshot['entity'];
	/** The policy fields to PUT back unchanged (094). */
	fields: FieldName[];
}

/**
 * What the access check (094, recipe 017) runs on: a Task the run will write (keep or claim) when
 * there is one, else any Task on a selected entity; null when none has a Task. The fields are the
 * template's non-empty policy fields, the ones the apply re-syncs (102); access.ts sends `step` as a
 * Step link (field_types/entity).
 */
export function accessSample(plans: EntityPlan[], snapshots: EntitySnapshot[], template: Template): AccessSample | null {
	const fields = nonEmptyPolicyFields(template);
	for (const p of plans) {
		const row = p.rows.find((r) => r.kind === 'keep' || r.kind === 'claim');
		if (row && (row.kind === 'keep' || row.kind === 'claim')) return { task: row.task, entity: p.entity, fields };
	}
	for (const s of snapshots) {
		if (s.tasks.length > 0) return { task: s.tasks[0], entity: s.entity, fields };
	}
	return null;
}

/** Why Next cannot build a plan yet, in screen order; null when it can. */
export function planBlocker(state: {
	project: { id: Id } | null;
	entityType: string | null;
	template: Template | null;
	selected: number;
}): string | null {
	if (!state.project) return 'Pick a project.';
	if (!state.entityType) return 'Pick an entity type.';
	if (!state.template) return 'Pick a template.';
	if (state.selected === 0) return 'Select at least one entity.';
	return null;
}
