/**
 * csv.ts: the plan as CSV, for review before applying (brief decision 8). Pure, no I/O.
 *
 * One row per Task action (`PlanRow`) per entity, plus one row per edge change (`EdgePlan`).
 * Columns are fixed (`PLAN_CSV_COLUMNS`); a row leaves the columns it has nothing to say blank.
 * RFC 4180 quoting (double-quote a cell holding a comma, quote or CR/LF; double an embedded
 * quote), CRLF line endings, a UTF-8 BOM for spreadsheet apps, and a `'` prefix on a cell
 * starting `= + - @` (formula injection).
 */

import { keyParts } from './matching';
import type {
	AffectedEdge,
	EntityPlan,
	EntityTask,
	EntitySnapshot,
	Edge,
	FieldChange,
	Id,
	MappedTask,
	MatchKey,
	PlanRow,
	PlanWarning,
	Template,
	TemplateTask
} from './types';
import type { EntityRef } from 'sg-widgets-core';

export const PLAN_CSV_COLUMNS = [
	'entity_type',
	'entity_id',
	'entity_name',
	'action',
	'task_id',
	'current_name',
	'template_task_id',
	'template_name',
	'normalized_key',
	'previous_template_task',
	'field_changes',
	'extra_action',
	'versions',
	'published_files',
	'edge_partner_task_id',
	'edge_partner_name',
	'edge_type',
	'edge_offset_days',
	'edge_decision',
	'warnings'
] as const;

type Column = (typeof PLAN_CSV_COLUMNS)[number];
type Row = Record<Column, string>;

function blankRow(): Row {
	const row = {} as Row;
	for (const column of PLAN_CSV_COLUMNS) row[column] = '';
	return row;
}

// --- value formatting --------------------------------------------------------------------------

function fmt(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (Array.isArray(value)) return value.map(fmt).join(', ');
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

function describeKey(key: MatchKey, step: EntityRef | null): string {
	const { content, stepId } = keyParts(key);
	const stepLabel = step?.name ?? (stepId === null ? 'no step' : String(stepId));
	return `${content || '(empty)'} @ ${stepLabel}`;
}

function describeLink(link: { id: Id; name?: string } | null): string {
	if (!link) return '';
	return link.name ? `${link.id} (${link.name})` : String(link.id);
}

/** `fmt`, but null/undefined and "" get an explicit marker so a change against "empty" reads clearly. */
function fmtFieldValue(value: unknown): string {
	if (value === null || value === undefined) return '∅';
	if (value === '') return '(empty)';
	return fmt(value);
}

function fmtFieldChanges(changes: FieldChange[]): string {
	return changes
		.map(
			(c) =>
				`${c.field}: ${fmtFieldValue(c.current)} -> ${fmtFieldValue(c.template)} [${c.policy} => ${fmtFieldValue(c.result)}]`
		)
		.join('; ');
}

function fmtWarning(w: PlanWarning): string {
	switch (w.code) {
		case 'template_entity_type_mismatch':
			return `template entity_type ${fmt(w.templateType)} vs entity ${w.entityType}`;
		case 'template_duplicate_key':
			return `duplicate template key "${keyParts(w.key).content}" on template tasks ${w.templateTaskIds.join(', ')}`;
		case 'delete_with_usage':
			return `delete with ${w.usage.versions} version(s), ${w.usage.publishedFiles} published file(s)`;
		case 'rename':
			return `${w.handRenamed ? 'renamed by hand' : 'renamed'}: ${fmt(w.from)} -> ${fmt(w.to)}`;
		case 'access_short':
			return `access: ${w.detail}`;
		case 'unresolved_conflict':
			return `unresolved conflict on template tasks ${w.templateTaskIds.join(', ')}`;
	}
}

function fmtWarnings(list: PlanWarning[]): string {
	return list.map(fmtWarning).join('; ');
}

function joinNonEmpty(parts: string[]): string {
	return parts.filter((p) => p.length > 0).join('; ');
}

// --- warning grouping: attach each warning to the row(s) it is about ---------------------------

interface WarningGroups {
	byTask: Map<Id, PlanWarning[]>;
	byTemplateTask: Map<Id, PlanWarning[]>;
	entityLevel: PlanWarning[];
}

function pushInto<K>(map: Map<K, PlanWarning[]>, key: K, w: PlanWarning): void {
	const list = map.get(key);
	if (list) list.push(w);
	else map.set(key, [w]);
}

function groupWarnings(warnings: PlanWarning[]): WarningGroups {
	const byTask = new Map<Id, PlanWarning[]>();
	const byTemplateTask = new Map<Id, PlanWarning[]>();
	const entityLevel: PlanWarning[] = [];
	for (const w of warnings) {
		switch (w.code) {
			case 'delete_with_usage':
			case 'rename':
				pushInto(byTask, w.taskId, w);
				break;
			case 'template_duplicate_key':
			case 'unresolved_conflict':
				for (const id of w.templateTaskIds) pushInto(byTemplateTask, id, w);
				break;
			case 'template_entity_type_mismatch':
			case 'access_short':
				entityLevel.push(w);
				break;
		}
	}
	return { byTask, byTemplateTask, entityLevel };
}

// --- entity Tasks reachable from a plan, for naming edge endpoints -----------------------------

function collectTasks(plan: EntityPlan): Map<Id, EntityTask> {
	const byId = new Map<Id, EntityTask>();
	for (const row of plan.rows) {
		if (row.kind === 'keep' || row.kind === 'claim' || row.kind === 'extra') {
			byId.set(row.task.id, row.task);
		} else if (row.kind === 'conflict') {
			for (const c of row.candidates) byId.set(c.task.id, c.task);
		}
	}
	return byId;
}

function entityCells(entity: EntitySnapshot['entity']): Pick<Row, 'entity_type' | 'entity_id' | 'entity_name'> {
	return {
		entity_type: entity.entityType,
		entity_id: fmt(entity.id),
		entity_name: fmt(entity.name ?? null)
	};
}

// --- one row per PlanRow ------------------------------------------------------------------------

function taskRow(plan: EntityPlan, row: PlanRow, groups: WarningGroups): Row {
	const r = blankRow();
	Object.assign(r, entityCells(plan.entity));
	r.action = row.kind;

	switch (row.kind) {
		case 'keep':
		case 'claim': {
			r.task_id = fmt(row.task.id);
			r.current_name = fmt(row.task.content);
			r.template_task_id = fmt(row.templateTask.id);
			r.template_name = fmt(row.templateTask.content);
			r.normalized_key = describeKey(row.templateTask.key, row.templateTask.step);
			r.field_changes = fmtFieldChanges(row.fieldChanges);
			if (row.kind === 'claim') r.previous_template_task = describeLink(row.previousTemplateTask);
			r.warnings = fmtWarnings([
				...(groups.byTask.get(row.task.id) ?? []),
				...(groups.byTemplateTask.get(row.templateTask.id) ?? [])
			]);
			break;
		}
		case 'create': {
			r.template_task_id = fmt(row.templateTask.id);
			r.template_name = fmt(row.templateTask.content);
			r.normalized_key = describeKey(row.templateTask.key, row.templateTask.step);
			r.warnings = fmtWarnings(groups.byTemplateTask.get(row.templateTask.id) ?? []);
			break;
		}
		case 'extra': {
			r.task_id = fmt(row.task.id);
			r.current_name = fmt(row.task.content);
			r.normalized_key = describeKey(row.task.key, row.task.step);
			r.extra_action = row.action;
			r.versions = fmt(row.usage.versions);
			r.published_files = fmt(row.usage.publishedFiles);
			r.warnings = fmtWarnings(groups.byTask.get(row.task.id) ?? []);
			break;
		}
		case 'conflict': {
			r.template_task_id = row.templateTasks.map((t) => fmt(t.id)).join(', ');
			r.template_name = row.templateTasks.map((t) => fmt(t.content)).join(' / ');
			r.normalized_key = describeKey(row.key, row.templateTasks[0]?.step ?? null);
			r.task_id = row.candidates.map((c) => fmt(c.task.id)).join(', ');
			r.current_name = row.candidates.map((c) => fmt(c.task.content)).join(' / ');
			r.versions = row.candidates.map((c) => fmt(c.usage.versions)).join(', ');
			r.published_files = row.candidates.map((c) => fmt(c.usage.publishedFiles)).join(', ');
			r.warnings = joinNonEmpty([
				fmtWarnings(row.templateTasks.flatMap((t) => groups.byTemplateTask.get(t.id) ?? [])),
				`pre-pick (${row.reason}): ${describeLink(pickDescriptor(row))}`
			]);
			break;
		}
	}
	return r;
}

function pickDescriptor(row: Extract<PlanRow, { kind: 'conflict' }>): { id: Id; name?: string } | null {
	const templateTaskId = row.templateTasks[0]?.id;
	const pickedId = templateTaskId === undefined ? undefined : row.pick[templateTaskId];
	if (pickedId === undefined || pickedId === null) return null;
	const candidate = row.candidates.find((c) => c.task.id === pickedId);
	return { id: pickedId, name: candidate?.task.content ?? undefined };
}

// --- one row per edge change ---------------------------------------------------------------------

function endInfo(
	end: MappedTask,
	templateTaskId: Id,
	templateTaskById: Map<Id, TemplateTask>,
	taskById: Map<Id, EntityTask>
): { taskId: string; name: string } {
	if ('existing' in end) {
		const task = taskById.get(end.existing);
		const tt = templateTaskById.get(templateTaskId);
		return { taskId: fmt(end.existing), name: fmt(task?.content ?? tt?.content ?? null) };
	}
	const tt = templateTaskById.get(templateTaskId);
	return { taskId: '', name: tt ? `${fmt(tt.content)} (new)` : '(new)' };
}

function edgeAddRow(
	plan: EntityPlan,
	added: EntityPlan['edges']['expectedAdded'][number],
	templateTaskById: Map<Id, TemplateTask>,
	taskById: Map<Id, EntityTask>
): Row {
	const r = blankRow();
	Object.assign(r, entityCells(plan.entity));
	r.action = 'edge-add';
	const down = endInfo(added.downstream, added.templateEdge.downstream, templateTaskById, taskById);
	const up = endInfo(added.upstream, added.templateEdge.upstream, templateTaskById, taskById);
	r.task_id = down.taskId;
	r.current_name = down.name;
	r.template_task_id = fmt(added.templateEdge.downstream);
	r.template_name = fmt(templateTaskById.get(added.templateEdge.downstream)?.content ?? null);
	r.edge_partner_task_id = up.taskId;
	r.edge_partner_name = up.name;
	r.edge_type = added.templateEdge.type;
	r.edge_offset_days = fmt(added.templateEdge.offsetDays);
	return r;
}

function affectedEdgeRow(plan: EntityPlan, aff: AffectedEdge, taskById: Map<Id, EntityTask>): Row {
	const r = blankRow();
	Object.assign(r, entityCells(plan.entity));
	r.action = aff.cause === 'replaced' ? 'edge-replace' : 'edge-delete';
	r.task_id = fmt(aff.existing.downstream);
	r.current_name = fmt(taskById.get(aff.existing.downstream)?.content ?? null);
	r.edge_partner_task_id = fmt(aff.existing.upstream);
	r.edge_partner_name = fmt(taskById.get(aff.existing.upstream)?.content ?? null);
	if (aff.replacedBy) {
		r.edge_type = `${aff.existing.type} -> ${aff.replacedBy.type}`;
		r.edge_offset_days = `${fmt(aff.existing.offsetDays)} -> ${fmt(aff.replacedBy.offsetDays)}`;
	} else {
		r.edge_type = aff.existing.type;
		r.edge_offset_days = fmt(aff.existing.offsetDays);
	}
	r.edge_decision = aff.action;
	return r;
}

function toExtraEdgeRow(plan: EntityPlan, edge: Edge, taskById: Map<Id, EntityTask>): Row {
	const r = blankRow();
	Object.assign(r, entityCells(plan.entity));
	r.action = 'edge-extra';
	r.task_id = fmt(edge.downstream);
	r.current_name = fmt(taskById.get(edge.downstream)?.content ?? null);
	r.edge_partner_task_id = fmt(edge.upstream);
	r.edge_partner_name = fmt(taskById.get(edge.upstream)?.content ?? null);
	r.edge_type = edge.type;
	r.edge_offset_days = fmt(edge.offsetDays);
	r.edge_decision = 'keep';
	return r;
}

function edgeRows(plan: EntityPlan, templateTaskById: Map<Id, TemplateTask>, taskById: Map<Id, EntityTask>): Row[] {
	return [
		...plan.edges.expectedAdded.map((added) => edgeAddRow(plan, added, templateTaskById, taskById)),
		...plan.edges.affected.map((aff) => affectedEdgeRow(plan, aff, taskById)),
		...plan.edges.toExtras.map((edge) => toExtraEdgeRow(plan, edge, taskById))
	];
}

// --- RFC 4180 -------------------------------------------------------------------------------------

function csvCell(value: string): string {
	let v = value;
	if (/^[=+\-@]/.test(v)) v = `'${v}`;
	if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
	return v;
}

function csvLine(row: Row): string {
	return PLAN_CSV_COLUMNS.map((c) => csvCell(row[c])).join(',');
}

// --- entry point ------------------------------------------------------------------------------

export function planToCsv(plans: EntityPlan[], template: Template): string {
	const templateTaskById = new Map(template.tasks.map((t) => [t.id, t] as const));
	const lines: string[] = [PLAN_CSV_COLUMNS.map((c) => csvCell(c)).join(',')];

	for (const plan of plans) {
		const taskById = collectTasks(plan);
		const groups = groupWarnings(plan.warnings);
		const rows: Row[] = [
			...plan.rows.map((row) => taskRow(plan, row, groups)),
			...edgeRows(plan, templateTaskById, taskById)
		];

		if (rows.length === 0) {
			const r = blankRow();
			Object.assign(r, entityCells(plan.entity));
			r.action = plan.noop ? 'noop' : '';
			rows.push(r);
		}

		if (groups.entityLevel.length > 0) {
			rows[0].warnings = joinNonEmpty([rows[0].warnings, fmtWarnings(groups.entityLevel)]);
		}

		for (const row of rows) lines.push(csvLine(row));
	}

	return `﻿${lines.join('\r\n')}\r\n`;
}
