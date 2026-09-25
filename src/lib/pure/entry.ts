/**
 * Entry: what the first screens decide before a plan exists. Which entities a list shows, which
 * templates a type offers, the run's starting options, and the sample the access check runs on. Pure, no I/O.
 */

import { nameSearchFilter, toApi3Hash, type WireGroup } from 'sg-widgets-core';
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
	RunOptions,
	Template
} from './types';

/** The entities list's filter on `task_template`: any, this template, another one, none. */
export type ListFilter = 'all' | 'using' | 'other' | 'none';

const LIST_FILTERS: readonly ListFilter[] = ['all', 'using', 'other', 'none'];

/**
 * The `_search` filter behind the entities list, on the project. `using` narrows to `task_template`
 * is the template, `none` to is null, `other` to neither: `is_not null` beside `is_not` the template
 * keeps unset rows out whether or not `is_not` matches them (the corpus measures that on duration
 * only, doors/field_types). The search is sg-widgets' own (`nameSearchFilter`): every word must sit
 * in `code`, one `contains` per word, all required (doors/findings-filter).
 */
export function entityListFilters(projectId: Id, filter: ListFilter, templateId: Id | null, search: string): WireGroup {
	const conditions: WireGroup['conditions'] = [['project', 'is', { type: 'Project', id: projectId }]];
	const template = templateId === null ? null : { type: 'TaskTemplate', id: templateId };
	if (filter === 'using' && template) conditions.push(['task_template', 'is', template]);
	if (filter === 'other') {
		if (template) conditions.push(['task_template', 'is_not', template]);
		conditions.push(['task_template', 'is_not', null]);
	}
	if (filter === 'none') conditions.push(['task_template', 'is', null]);
	const words = toApi3Hash(nameSearchFilter(search, ['code']));
	if (words) conditions.push(...(words.logical_operator === 'and' ? words.conditions : [words]));
	return { logical_operator: 'and', conditions };
}

/** The list opens on the template's entities when it has any, else on the whole type (#59). */
export function openingFilter(using: number): ListFilter {
	return using > 0 ? 'using' : 'all';
}

/**
 * The filter a retired entry point implied (runs and picks saved before #59): every entity using it
 * on Using this template, pick entities on All, no template on No template. Null for anything else.
 */
export function legacyFilter(entry: unknown): ListFilter | null {
	if (entry === 'template_first') return 'using';
	if (entry === 'entities_first') return 'all';
	if (entry === 'no_template') return 'none';
	return null;
}

/** A stored list filter when it is one of the four, else what a retired entry point implied, else null. */
export function storedFilter(filter: unknown, legacyEntry?: unknown): ListFilter | null {
	return LIST_FILTERS.find((f) => f === filter) ?? legacyFilter(legacyEntry);
}

/** A pick on the entities list. `name` is the code, when the read carried it. */
type Pick = { type: string; id: Id; name?: string };

/** `current` with every row of `added` it lacks, in order. Select all matching adds; only Clear empties. */
export function addToSelection<T extends Pick>(current: readonly T[], added: readonly T[]): T[] {
	const held = new Set(current.map((ref) => `${ref.type}:${ref.id}`));
	return [...current, ...added.filter((ref) => !held.has(`${ref.type}:${ref.id}`))];
}

/** The list filter narrowed to the picked ids: what the list shows of the selection. */
export function selectedWithin(filters: WireGroup, picked: readonly Pick[]): WireGroup {
	return { logical_operator: 'and', conditions: [...filters.conditions, ['id', 'in', picked.map((ref) => ref.id)]] };
}

/** Show selected: the project's picked entities, whatever the list filter says. */
export function onlySelected(projectId: Id, picked: readonly Pick[]): WireGroup {
	return selectedWithin({ logical_operator: 'and', conditions: [['project', 'is', { type: 'Project', id: projectId }]] }, picked);
}

/** "N selected · M hidden by the filter". `shown` is how many picks the filter matches; null until counted. */
export function selectionLine(selected: number, shown: number | null): { selected: number; hidden: number } {
	return { selected, hidden: shown === null ? 0 : Math.max(0, selected - shown) };
}

const byCode = (a: Template, b: Template) => a.code.localeCompare(b.code, undefined, { sensitivity: 'base' }) || a.id - b.id;

/**
 * The type's own templates, then the rest. A template's `entity_type` is not enforced (083): another
 * type's template is offered too, and the plan warns on the mismatch (brief 7). `query` narrows both
 * lists to codes holding it, case-insensitive.
 */
export function templatesByType(templates: Template[], entityType: string | null, query = ''): { matching: Template[]; others: Template[] } {
	const needle = query.trim().toLocaleLowerCase();
	const shown = needle ? templates.filter((t) => t.code.toLocaleLowerCase().includes(needle)) : templates;
	const matching = shown.filter((t) => entityType !== null && t.entityType === entityType).sort(byCode);
	const others = shown.filter((t) => entityType === null || t.entityType !== entityType).sort(byCode);
	return { matching, others };
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
