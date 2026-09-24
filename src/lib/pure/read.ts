/**
 * Read: wire rows to domain. Pure, no I/O.
 *
 * Turns `_search`/`_batch` rows (Task, TaskTemplate, TaskDependency, Version, PublishedFile) and
 * the project's schema into the domain types of `types.ts`. Also works out which fields a call
 * needs to ask for: the built-ins every Task read wants, plus whichever fields are "under policy"
 * for a given template — the ones the apply overwrites when a template task's value is non-empty
 * (102) — custom fields included.
 *
 * `.fields` on a `TaskCore` (see types.ts) holds every policy-relevant field's raw wire value,
 * keyed by wire name, so `nonEmptyPolicyFields` and later `planner.ts` can look any of them up the
 * same way whether they are built in (`content`, `step`, ...) or a site's own custom field.
 */

import { usableStatuses, type EntityRow, type FieldSchema } from 'sg-widgets-core';
import { matchKey } from './matching';
import {
	type DefaultTaskTemplates,
	type DependencyType,
	type Edge,
	type EntityRef,
	type EntityTask,
	type FieldName,
	type Id,
	type ProjectContext,
	type Template,
	type TemplateTask,
	type TaskCore,
	type TaskUsage
} from './types';

const DEFAULT_DEPENDENCY_TYPE: DependencyType = 'finish-to-start-next-day';

/*
 * `policyFields` below hard-codes the same field set `APPLY_RESYNCED_FIELDS` and
 * `APPLY_RESYNCED_IF_UNDATED` name (content, step, sg_sort_order, duration, est_in_mins,
 * sg_description, milestone, task_reviewers): those two are the built-in half of "every field
 * under policy" (102); the loop below adds whatever custom fields a row also carries.
 */

/** Attribute keys already named on `TaskAttributes`: never folded into `.fields` as "custom". */
const TASK_ATTRIBUTE_KEYS = new Set([
	'content',
	'sg_status_list',
	'sg_sort_order',
	'duration',
	'est_in_mins',
	'sg_description',
	'milestone',
	'start_date',
	'due_date',
	'pinned',
	'dependency_violation',
	'created_at'
]);

/** The fields every Task call requests, whatever the template (contracts/modules.md, brief). */
export const BASE_TASK_FIELDS: readonly string[] = [
	'content',
	'sg_status_list',
	'sg_sort_order',
	'duration',
	'est_in_mins',
	'sg_description',
	'milestone',
	'start_date',
	'due_date',
	'pinned',
	'dependency_violation',
	'created_at',
	'entity',
	'step',
	'project',
	'template_task',
	'task_template',
	'upstream_tasks',
	'downstream_tasks',
	'task_assignees',
	'task_reviewers'
];

// --- small wire readers -------------------------------------------------------------------------

function str(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
	return typeof v === 'number' ? v : null;
}

function bool(v: unknown): boolean {
	return v === true;
}

type RelData = EntityRef | EntityRef[] | null | undefined;

function relData(row: EntityRow, key: string): RelData {
	return row.relationships?.[key]?.data as RelData;
}

function singleRef(row: EntityRow, key: string): EntityRef | null {
	const d = relData(row, key);
	return d && !Array.isArray(d) ? d : null;
}

function multiRef(row: EntityRow, key: string): EntityRef[] {
	const d = relData(row, key);
	return Array.isArray(d) ? d : [];
}

/** `"...T..Z"` (`_search`) or `"... UTC"` (batch rows) normalized to ISO (fixtures.md). */
function normalizeCreatedAt(v: unknown): string {
	if (typeof v !== 'string') return '';
	const m = v.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/);
	return m ? `${m[1]}T${m[2]}Z` : v;
}

/** `false`, `null`, `undefined`, `""` and `[]` count as empty (102, Q-F). `0` does not. */
function isNonEmptyValue(v: unknown): boolean {
	if (v === null || v === undefined || v === '' || v === false) return false;
	if (Array.isArray(v)) return v.length > 0;
	return true;
}

/**
 * Every policy field's raw wire value, keyed by wire name: the built-ins (`step` and
 * `task_reviewers` flattened to a comparable id / id list) plus whatever custom attributes the row
 * carries beyond `TaskAttributes`.
 */
function policyFields(row: EntityRow, step: EntityRef | null, reviewers: EntityRef[]): Record<FieldName, unknown> {
	const a = row.attributes ?? {};
	const out: Record<FieldName, unknown> = {
		content: str(a.content),
		step: step?.id ?? null,
		sg_sort_order: num(a.sg_sort_order),
		duration: num(a.duration),
		est_in_mins: num(a.est_in_mins),
		sg_description: str(a.sg_description),
		milestone: bool(a.milestone),
		task_reviewers: reviewers.map((r) => r.id).sort((x, y) => x - y)
	};
	for (const [k, v] of Object.entries(a)) {
		if (!TASK_ATTRIBUTE_KEYS.has(k)) out[k] = v;
	}
	return out;
}

function core(row: EntityRow): Omit<TaskCore, 'assignees' | 'reviewers' | 'fields'> & {
	assignees: EntityRef[];
	reviewers: EntityRef[];
	fields: Record<FieldName, unknown>;
} {
	const a = row.attributes ?? {};
	const step = singleRef(row, 'step');
	const content = str(a.content);
	const assignees = multiRef(row, 'task_assignees');
	const reviewers = multiRef(row, 'task_reviewers');
	return {
		id: row.id,
		content,
		step,
		key: matchKey(content, step?.id ?? null),
		status: str(a.sg_status_list),
		sortOrder: num(a.sg_sort_order),
		duration: num(a.duration),
		estInMins: num(a.est_in_mins),
		description: str(a.sg_description),
		milestone: bool(a.milestone),
		startDate: str(a.start_date),
		dueDate: str(a.due_date),
		assignees,
		reviewers,
		fields: policyFields(row, step, reviewers)
	};
}

// --- wire rows to domain -------------------------------------------------------------------------

/**
 * A Task row with `task_template` set and `project` null (entity_types/TaskTemplate). Throws when
 * the row has no `task_template` link: it is not a template task.
 */
export function templateTaskFromRow(row: EntityRow): TemplateTask {
	const templateRef = singleRef(row, 'task_template');
	if (!templateRef) throw new Error(`templateTaskFromRow: Task ${row.id} has no task_template`);
	return { ...core(row), templateId: templateRef.id };
}

/**
 * An entity's own Task. `templateOf` resolves a `template_task` id to the id of the template it
 * belongs to, when known (a read of that template task); absent link info reads as `null`.
 */
export function taskFromRow(row: EntityRow, templateOf: (templateTaskId: Id) => Id | null): EntityTask {
	const a = row.attributes ?? {};
	const entity = singleRef(row, 'entity');
	if (!entity) throw new Error(`taskFromRow: Task ${row.id} has no entity`);
	const templateTaskRef = singleRef(row, 'template_task');
	return {
		...core(row),
		entity,
		templateTask: templateTaskRef
			? { id: templateTaskRef.id, name: templateTaskRef.name, templateId: templateOf(templateTaskRef.id) }
			: null,
		pinned: bool(a.pinned),
		dependencyViolation: bool(a.dependency_violation),
		createdAt: normalizeCreatedAt(a.created_at)
	};
}

/** A TaskDependency row (entity_types/Task "Dependencies", 085). `task` is downstream. */
export function edgeFromRow(row: EntityRow): Edge {
	const a = row.attributes ?? {};
	const downstream = num(a.task_id) ?? singleRef(row, 'task')?.id ?? 0;
	const upstream = num(a.dependent_task_id) ?? singleRef(row, 'dependent_task')?.id ?? 0;
	const type = (typeof a.dependency_type === 'string' ? a.dependency_type : null) as DependencyType | null;
	return {
		id: row.id,
		downstream,
		upstream,
		type: type ?? DEFAULT_DEPENDENCY_TYPE,
		offsetDays: num(a.offset_days)
	};
}

function byTemplateOrder(a: TemplateTask, b: TemplateTask): number {
	if (a.sortOrder !== b.sortOrder) {
		if (a.sortOrder === null) return 1;
		if (b.sortOrder === null) return -1;
		return a.sortOrder - b.sortOrder;
	}
	return a.id - b.id;
}

/** A TaskTemplate plus its template tasks (sorted) and the edges between them. */
export function templateFromRows(tpl: EntityRow, tasks: EntityRow[], deps: EntityRow[]): Template {
	const a = tpl.attributes ?? {};
	return {
		id: tpl.id,
		code: str(a.code) ?? '',
		entityType: str(a.entity_type),
		tasks: tasks.map(templateTaskFromRow).sort(byTemplateOrder),
		edges: deps.map(edgeFromRow)
	};
}

/** Versions and PublishedFiles grouped by the Task they point at (089: `sg_task`, `task`). */
export function usageFromRows(versions: EntityRow[], publishedFiles: EntityRow[]): Record<Id, TaskUsage> {
	const out: Record<Id, TaskUsage> = {};
	const bump = (row: EntityRow, relKey: string, field: keyof TaskUsage) => {
		const id = singleRef(row, relKey)?.id;
		if (id === undefined) return;
		out[id] ??= { versions: 0, publishedFiles: 0 };
		out[id][field] += 1;
	};
	for (const v of versions) bump(v, 'sg_task', 'versions');
	for (const p of publishedFiles) bump(p, 'task', 'publishedFiles');
	return out;
}

/** `Project.tracking_settings.default_task_template` (088). Absent, `{}` and a missing key = null. */
export function defaultTemplateFor(trackingSettings: unknown, entityType: string): EntityRef | null {
	if (!trackingSettings || typeof trackingSettings !== 'object') return null;
	const dtt = (trackingSettings as Record<string, unknown>).default_task_template;
	if (!dtt || typeof dtt !== 'object') return null;
	const entry = (dtt as DefaultTaskTemplates)[entityType];
	if (!entry) return null;
	return { type: 'TaskTemplate', id: entry.id, name: entry.name };
}

/** Entity types whose schema declares a `task_template` field, custom entities included (brief 1). */
export function templatableTypes(fieldsByType: Record<string, Record<string, FieldSchema>>): string[] {
	return Object.entries(fieldsByType)
		.filter(([, fields]) => 'task_template' in fields)
		.map(([type]) => type);
}

/** `defaultTaskStatus` and `validTaskStatuses` (valid minus hidden) off a normalized status field. */
export function taskStatusContext(field: FieldSchema): Pick<ProjectContext, 'defaultTaskStatus' | 'validTaskStatuses'> {
	return {
		defaultTaskStatus: typeof field.defaultValue === 'string' ? field.defaultValue : '',
		validTaskStatuses: usableStatuses(field).map((s) => s.code)
	};
}

/** Policy fields whose value is non-empty on at least one of the template's tasks (102, decisions). */
export function nonEmptyPolicyFields(template: Template): FieldName[] {
	const names = new Set<FieldName>();
	for (const t of template.tasks) {
		for (const [name, value] of Object.entries(t.fields)) {
			if (isNonEmptyValue(value)) names.add(name);
		}
	}
	return [...names].sort();
}

/** The fields to request when reading this template's Tasks: the base set plus its policy fields. */
export function taskFieldsFor(template: Template): string[] {
	return [...new Set([...BASE_TASK_FIELDS, ...nonEmptyPolicyFields(template)])];
}
