/**
 * csv.ts: the plan as CSV, for review before applying (brief decision 8). Pure, no I/O.
 *
 * Per entity, in order:
 *   1. one entity row: action `apply` or `noop`, the five counts, entity-level warnings;
 *   2. one row per plan row: keep, claim, create, extra, and one `conflict` row per template task
 *      of a conflict (Q-E), next to the keep/claim/create it resolves to;
 *   3. one row per edge pair: `edge-add` (a template edge that survives the run), `edge-replace`,
 *      `edge-delete`, `edge-outside` (one end not linked to the template, 109).
 * Tasks print as `name #id`, a created Task as `name (new)`, refs by name. Each warning prints once,
 * on the row it is about. Values print as they are (no formula guard, Kevin). RFC 4180 quoting,
 * CRLF line endings, a UTF-8 BOM for spreadsheet apps.
 */

import { keyParts } from './matching';
import type {
	AffectedEdge,
	ConflictRow,
	Edge,
	EntityPlan,
	EntityTask,
	FieldChange,
	FieldName,
	Id,
	MappedTask,
	MatchKey,
	PlanRow,
	PlanWarning,
	TaskUsage,
	Template,
	TemplateTask
} from './types';

export const PLAN_CSV_COLUMNS = [
	'entity',
	'action',
	'task', // the Task; conflict: its candidates in pre-pick order
	'template_task', // entity row: the template
	'key', // normalized content @ step
	'reason', // why this action; entity row: the counts
	'field_changes',
	'decision', // extra action, conflict pick, edge keep/remove
	'usage', // Versions and PublishedFiles (089)
	'edge_upstream',
	'edge_downstream',
	'edge_spec', // type and offset; replace: old -> template
	'dates', // may move / would flag (092); create: template dates and the clear option (097)
	'warnings'
] as const;

type Column = (typeof PLAN_CSV_COLUMNS)[number];
type Row = Record<Column, string>;
type StepRef = { name?: string } | null;

const BOM = '﻿';

// --- values -------------------------------------------------------------------------------------

/** A field value: refs by name, lists joined, null as ∅, "" as (empty). */
function value(v: unknown): string {
	if (v === null || v === undefined) return '∅';
	if (v === '') return '(empty)';
	if (Array.isArray(v)) return v.length === 0 ? '(none)' : v.map(value).join(', ');
	if (typeof v === 'object') {
		const o = v as { name?: unknown; id?: unknown };
		if (typeof o.name === 'string') return o.name;
		if (o.id !== undefined) return `#${o.id}`;
		return JSON.stringify(v);
	}
	return String(v);
}

const taskLabel = (t: { id: Id; content: string | null }) => `${t.content ?? '(no name)'} #${t.id}`;
const newLabel = (tt: TemplateTask | undefined) => `${tt?.content ?? '(no name)'} (new)`;

function keyLabel(key: MatchKey, step: StepRef): string {
	const { content, stepId } = keyParts(key);
	const stepName = step?.name ?? (stepId === null ? 'no step' : `step #${stepId}`);
	return `${content || '(empty)'} @ ${stepName}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const usageCounts = (u: TaskUsage) =>
	`${plural(u.versions, 'version')}, ${plural(u.publishedFiles, 'published file')}`;

function usageLabel(u: TaskUsage): string {
	if (u.versions === 0 && u.publishedFiles === 0) return 'none';
	if (u.publishedFiles === 0) return plural(u.versions, 'version');
	if (u.versions === 0) return plural(u.publishedFiles, 'published file');
	return usageCounts(u);
}

/** A field by its display name with the code name beside it, the code name alone without one. */
function fieldName(field: FieldName, labels: Record<FieldName, string> | undefined): string {
	const label = labels?.[field]?.trim();
	return label && label !== field ? `${label} (${field})` : field;
}

function fieldChangesLabel(changes: FieldChange[] | undefined, skipContent: boolean, labels?: Record<FieldName, string>): string {
	return (changes ?? [])
		.filter((c) => !(skipContent && c.field === 'content'))
		.map((c) =>
			c.result === c.current
				? `${fieldName(c.field, labels)}: keeps ${value(c.current)}, template ${value(c.template)} (${c.policy})`
				: `${fieldName(c.field, labels)}: ${value(c.current)} -> ${value(c.result)} (${c.policy})`
		)
		.join('; ');
}

const specLabel = (e: Edge) => `${e.type}, offset ${e.offsetDays === null ? 'none' : e.offsetDays}`;

function warningLabel(w: PlanWarning, stepOf: (key: MatchKey) => StepRef): string {
	switch (w.code) {
		case 'template_entity_type_mismatch':
			return `template is for ${w.templateType}, entity is ${w.entityType}`;
		case 'template_duplicate_key':
			return `template has ${w.templateTaskIds.length} tasks of key ${keyLabel(w.key, stepOf(w.key))}`;
		case 'delete_with_usage':
			return `delete with ${usageCounts(w.usage)}`;
		case 'rename':
			return `${w.handRenamed ? 'RENAMED BY HAND' : 'rename'}: ${w.from ?? '∅'} -> ${w.to ?? '∅'}`;
		case 'access_short':
			return `access: ${w.detail}`;
		case 'unresolved_conflict':
			return `pick not valid on template tasks ${w.templateTaskIds.map((id) => `#${id}`).join(', ')}: pre-pick used`;
		case 'edge_closes_loop':
			return `edge #${w.edgeId} would close a loop: ${w.action} (107)`;
	}
}

// --- one entity ---------------------------------------------------------------------------------

function entityRows(plan: EntityPlan, template: Template, labels?: Record<FieldName, string>): Row[] {
	const { entityType, name, id } = plan.entity;
	const entity = name ? `${entityType} ${name} #${id}` : `${entityType} #${id}`;
	const blank = (action: string): Row => {
		const r = {} as Row;
		for (const c of PLAN_CSV_COLUMNS) r[c] = '';
		r.entity = entity;
		r.action = action;
		return r;
	};

	const ttById = new Map(template.tasks.map((t) => [t.id, t] as const));
	const taskById = new Map<Id, EntityTask>();
	for (const row of plan.rows) {
		if (row.kind === 'conflict') for (const c of row.candidates) taskById.set(c.task.id, c.task);
		else if (row.kind !== 'create') taskById.set(row.task.id, row.task);
	}
	const idLabel = (taskId: Id) => {
		const t = taskById.get(taskId);
		return t ? taskLabel(t) : `#${taskId}`;
	};
	const endLabel = (m: MappedTask) =>
		'existing' in m ? idLabel(m.existing) : newLabel(ttById.get(m.created));
	const stepOf = (key: MatchKey): StepRef => template.tasks.find((t) => t.key === key)?.step ?? null;

	// Warnings: each prints once, on the first row it is about; the rest on the entity row.
	const pending = [...plan.warnings];
	const take = (r: Row, about: (w: PlanWarning) => boolean) => {
		const mine = pending.filter(about);
		if (mine.length === 0) return;
		for (const w of mine) pending.splice(pending.indexOf(w), 1);
		r.warnings = mine.map((w) => warningLabel(w, stepOf)).join('; ');
	};
	const aboutTask = (taskId: Id) => (w: PlanWarning) =>
		(w.code === 'rename' || w.code === 'delete_with_usage') && w.taskId === taskId;
	const aboutTemplateTask = (ttId: Id) => (w: PlanWarning) =>
		(w.code === 'template_duplicate_key' || w.code === 'unresolved_conflict') &&
		w.templateTaskIds.includes(ttId);

	const mayMove = new Set(plan.edges.mayMove);
	const wouldViolate = new Set(plan.edges.wouldViolate);
	const datesOf = (taskId: Id) =>
		wouldViolate.has(taskId)
			? 'pinned: would flag dependency_violation (092)'
			: mayMove.has(taskId)
				? 'may move (092)'
				: '';

	// 1. The entity row.
	const head = blank(plan.noop ? 'noop' : 'apply');
	head.template_task = `${template.code} #${template.id}`;
	const c = plan.counts;
	head.reason = plan.noop
		? `already on ${template.code}: nothing to write`
		: `keep ${c.keep}, claim ${c.claim}, create ${c.create}, extra ${c.extra}, conflict ${c.conflict}` +
			(plan.needsClearFirst ? `; already on ${template.code}: cleared then set (084)` : '');
	const rows: Row[] = [head];

	// 2. Task rows.
	const taskRow = (row: Exclude<PlanRow, ConflictRow>): Row => {
		const r = blank(row.kind);
		switch (row.kind) {
			case 'keep':
			case 'claim': {
				r.task = taskLabel(row.task);
				r.template_task = taskLabel(row.templateTask);
				r.key = keyLabel(row.templateTask.key, row.templateTask.step);
				if (row.kind === 'keep') {
					r.reason = row.keyMismatch ? 'linked; key differs (renamed or step moved)' : 'linked';
				} else {
					const prev = row.previousTemplateTask;
					r.reason = prev
						? `was linked to #${prev.id}${prev.name ? ` ${prev.name}` : ''}` +
							(prev.templateId !== null ? ` (template ${prev.templateId})` : '')
						: 'unlinked, same key';
				}
				// A rename prints once, as a warning, not again as a content change.
				r.field_changes = fieldChangesLabel(row.fieldChanges, row.rename !== null, labels);
				r.dates = datesOf(row.task.id);
				take(r, aboutTask(row.task.id));
				break;
			}
			case 'create': {
				const tt = row.templateTask;
				r.task = newLabel(tt);
				r.template_task = taskLabel(tt);
				r.key = keyLabel(tt.key, tt.step);
				r.reason = 'no Task with this key';
				const { start, due } = row.templateDates;
				r.dates =
					(start === null && due === null
						? 'no template dates'
						: `template dates ${start ?? '∅'} .. ${due ?? '∅'}`) +
					(row.datesClearable ? '; clearable' : '; not clearable (upstream edge)');
				break;
			}
			case 'extra': {
				r.task = taskLabel(row.task);
				r.key = keyLabel(row.task.key, row.task.step);
				r.reason = row.reason;
				r.decision = row.action;
				r.usage = usageLabel(row.usage);
				r.field_changes = fieldChangesLabel(row.fieldChanges, false, labels);
				r.dates = datesOf(row.task.id);
				take(r, aboutTask(row.task.id));
				break;
			}
		}
		return r;
	};

	const choice = (taskId: Id | null) => (taskId === null ? 'create a new Task' : idLabel(taskId));
	const conflictRows = (row: ConflictRow): Row[] =>
		row.templateTasks.map((tt) => {
			const r = blank('conflict');
			r.task = row.candidates.map((x) => taskLabel(x.task)).join(', ');
			r.template_task = taskLabel(tt);
			r.key = keyLabel(row.key, tt.step);
			r.reason = `pre-pick by ${row.reason}`;
			const pick = row.pick[tt.id] ?? null;
			const pre = row.prePick[tt.id] ?? null;
			r.decision =
				pick === pre
					? `pick = pre-pick: ${choice(pick)}`
					: `pick: ${choice(pick)}; pre-pick: ${choice(pre)}`;
			r.usage = row.candidates.map((x) => `#${x.task.id}: ${usageLabel(x.usage)}`).join('; ');
			take(r, aboutTemplateTask(tt.id));
			return r;
		});

	for (const row of plan.rows) {
		if (row.kind === 'conflict') rows.push(...conflictRows(row));
		else rows.push(taskRow(row));
	}

	// 3. Edge rows, one per pair. A replaced edge's row carries the template edge that takes its
	// place, so a surviving template edge on that pair is not listed again; transient copies
	// (`transientAdded`, deleted again by the batch) are never listed.
	const pair = (a: Id | string, b: Id | string) => [String(a), String(b)].sort().join('|');
	const end = (m: MappedTask) => ('existing' in m ? m.existing : `new${m.created}`);
	const replacedPairs = new Set(
		plan.edges.affected
			.filter((a) => a.cause === 'replaced')
			.map((a) => pair(a.existing.downstream, a.existing.upstream))
	);
	for (const add of plan.edges.expectedAdded) {
		if (replacedPairs.has(pair(end(add.downstream), end(add.upstream)))) continue;
		const r = blank('edge-add');
		r.edge_upstream = endLabel(add.upstream);
		r.edge_downstream = endLabel(add.downstream);
		r.edge_spec = specLabel(add.templateEdge);
		r.reason = 'template edge (099)';
		rows.push(r);
	}

	// An extra that is deleted takes its edges with it (103).
	const deleted = new Set<Id>();
	for (const r of plan.rows) if (r.kind === 'extra' && r.action === 'delete') deleted.add(r.task.id);
	const deletedEnd = (e: Edge) => [e.upstream, e.downstream].find((t) => deleted.has(t));
	const edgeRow = (action: string, e: Edge): Row => {
		const r = blank(action);
		r.edge_upstream = idLabel(e.upstream);
		r.edge_downstream = idLabel(e.downstream);
		r.edge_spec = specLabel(e);
		return r;
	};

	const affectedRow = (aff: AffectedEdge): Row => {
		const e = aff.existing;
		const action = {
			replaced: 'edge-replace',
			not_in_template: 'edge-delete',
			outside_upstream: 'edge-outside'
		}[aff.cause];
		const r = edgeRow(action, e);
		r.decision = aff.action;
		if (aff.cause === 'replaced') {
			const t = aff.replacedBy;
			if (t) r.edge_spec = `${specLabel(e)} -> ${specLabel(t)}`;
			const reversed = t !== null && t.downstream !== e.downstream;
			r.reason = `replaced by the template edge${reversed ? ', reversed' : ''} (101)`;
		} else if (aff.cause === 'not_in_template') {
			r.reason = 'not in the template: the apply deletes it (102)';
		} else {
			const gone = deletedEnd(e);
			if (gone !== undefined) {
				r.reason = `deleted with the extra ${idLabel(gone)} (103)`;
				r.decision = '';
			} else r.reason = 'outside Task upstream: erased by the apply (109)';
		}
		if (aff.closesLoop) r.reason += '; keeping it would close a loop (107)';
		take(r, (w) => w.code === 'edge_closes_loop' && w.edgeId === e.id);
		return r;
	};
	for (const aff of plan.edges.affected) rows.push(affectedRow(aff));

	for (const e of plan.edges.toExtras) {
		const r = edgeRow('edge-outside', e);
		const gone = deletedEnd(e);
		r.reason =
			gone !== undefined ? `deleted with the extra ${idLabel(gone)} (103)` : 'outside Task downstream: kept';
		rows.push(r);
	}

	// Tasks with no row of their own (another entity) that may move: named on the entity row.
	const unlisted = (ids: Id[]) => ids.filter((t) => !taskById.has(t)).map((t) => `#${t}`);
	const moves = unlisted(plan.edges.mayMove);
	const flags = unlisted(plan.edges.wouldViolate);
	head.dates = [
		moves.length ? `outside Tasks may move: ${moves.join(', ')}` : '',
		flags.length ? `outside pinned Tasks would flag: ${flags.join(', ')}` : ''
	]
		.filter(Boolean)
		.join('; ');

	take(head, () => true); // entity-level warnings, and any not placed on a row
	return rows;
}

// --- RFC 4180 -------------------------------------------------------------------------------------

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const line = (cells: readonly string[]) => cells.map(cell).join(',');

/** `labels`: Task field display names by code name; fields print as "Description (sg_description)". */
export function planToCsv(plans: EntityPlan[], template: Template, labels?: Record<FieldName, string>): string {
	const out = [line(PLAN_CSV_COLUMNS)];
	for (const plan of plans) {
		for (const r of entityRows(plan, template, labels)) out.push(line(PLAN_CSV_COLUMNS.map((c) => r[c])));
	}
	return `${BOM}${out.join('\r\n')}\r\n`;
}
