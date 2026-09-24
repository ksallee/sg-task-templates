/**
 * Plan view: what the plan screen shows and decides, from the run's plans and options. Pure, no I/O.
 *
 * - The entity list: the filter (by count kind, warnings, no-op, code) and each entity's warnings.
 * - The detail: rows grouped by action, Tasks named, keys shown normalized, edges with both ends
 *   named and why each keep is or is not offered (closesLoop, 085 and 107).
 * - The bulk options on top: the fields under policy with their choices (no fill-if-empty on
 *   booleans, Q-F), the omit status when the project has no `omt`, the clear-dates opt-in only where
 *   a created Task has no upstream edge (093, 097).
 * - What blocks Apply: an unresolved conflict, refused access (094), an omit with no status, deletes
 *   awaiting their second confirmation (089), a kept edge that closes a loop.
 *
 * Option setters return new `RunOptions`; `run.setOptions` re-plans from them.
 */

import { keyParts, normalizeContent } from './matching';
import { dependencyPhrase, offsetLabel } from './outline';
import { fieldsUnderPolicy, policyFor, withEntityConflictPick } from './planner';
import type {
	AccessSummary,
	AffectedEdge,
	ClaimRow,
	ConflictRow,
	CreateRow,
	DependencyType,
	EdgeAction,
	EntityPlan,
	EntityTask,
	ExtraAction,
	ExtraRow,
	FieldFill,
	FieldName,
	FieldPolicy,
	Id,
	KeepRow,
	MappedTask,
	MatchKey,
	PickReason,
	PlanKind,
	PlanRow,
	PlanWarning,
	ProjectContext,
	RunOptions,
	TaskUsage,
	Template
} from './types';

export const PLAN_KINDS: readonly PlanKind[] = ['keep', 'claim', 'create', 'extra', 'conflict'];

// ---------------------------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------------------------

/** The picks that apply to one entity: run-wide, then its own (planner `resolveConflict`). */
export function picksFor(opts: RunOptions, entityId: Id): Record<Id, Id | null> {
	return { ...opts.conflictPicks, ...(opts.entityConflictPicks?.[entityId] ?? {}) };
}

/** Resolved once the user has picked, or accepted the pre-pick, for every template task of it. */
export function conflictResolved(row: ConflictRow, opts: RunOptions, entityId: Id): boolean {
	const picks = picksFor(opts, entityId);
	return row.templateTasks.every((tt) => tt.id in picks);
}

/** Conflict rows still waiting for the user, plus planner `unresolved_conflict` warnings (invalid picks). */
export function unresolvedConflicts(plan: EntityPlan, opts: RunOptions): number {
	const rows = plan.rows.filter((r): r is ConflictRow => r.kind === 'conflict' && !conflictResolved(r, opts, plan.entity.id)).length;
	return rows + plan.warnings.filter((w) => w.code === 'unresolved_conflict').length;
}

/** Take the pick each unresolved conflict shows (the pre-pick, 2 Matching) as the user's, per entity. */
export function acceptPicks(opts: RunOptions, plans: EntityPlan[]): RunOptions {
	let next = opts;
	for (const p of plans) {
		for (const r of p.rows) {
			if (r.kind !== 'conflict') continue;
			const picks = picksFor(next, p.entity.id);
			for (const tt of r.templateTasks) if (!(tt.id in picks)) next = withEntityConflictPick(next, p.entity.id, tt.id, r.pick[tt.id] ?? null);
		}
	}
	return next;
}

// ---------------------------------------------------------------------------------------------
// Option setters
// ---------------------------------------------------------------------------------------------

/** Any change to an extra's action withdraws the delete confirmation: the list it confirmed changed. */
export function withExtraAction(opts: RunOptions, taskId: Id, action: ExtraAction): RunOptions {
	return { ...opts, extraOverrides: { ...opts.extraOverrides, [taskId]: action }, deleteConfirmed: false };
}

/** Bulk by normalized name; per-Task overrides of that name are dropped so the bulk choice shows. */
export function withExtraNameAction(opts: RunOptions, name: string, action: ExtraAction, plans: EntityPlan[]): RunOptions {
	const overrides = { ...opts.extraOverrides };
	for (const p of plans) {
		for (const r of p.rows) if (r.kind === 'extra' && normalized(r.task.content) === name) delete overrides[r.task.id];
	}
	return { ...opts, extraByName: { ...opts.extraByName, [name]: action }, extraOverrides: overrides, deleteConfirmed: false };
}

export function withEdgeAction(opts: RunOptions, edgeId: Id, action: EdgeAction): RunOptions {
	return { ...opts, edgeActions: { ...opts.edgeActions, [edgeId]: action } };
}

export function withOmitStatus(opts: RunOptions, status: string): RunOptions {
	return { ...opts, omitStatus: status };
}

export function withClearCreatedDates(opts: RunOptions, on: boolean): RunOptions {
	return { ...opts, clearCreatedDates: on };
}

export function withDeleteConfirmed(opts: RunOptions, on: boolean): RunOptions {
	return { ...opts, deleteConfirmed: on };
}

const normalized = normalizeContent;

// ---------------------------------------------------------------------------------------------
// Bulk options
// ---------------------------------------------------------------------------------------------

export interface PolicyFieldView {
	field: FieldName;
	policy: FieldPolicy;
	/** keep / overwrite, plus fill-if-empty unless the field is a boolean (Q-F), the name or the step (never empty). */
	choices: FieldPolicy[];
}

/** Fields that are never empty on a Task: fill-if-empty would never fill. */
const NEVER_EMPTY = new Set<FieldName>(['content', 'step']);

/** Every field under policy for this template (102), with its policy in this run. */
export function policyFieldViews(template: Template, opts: RunOptions): PolicyFieldView[] {
	return fieldsUnderPolicy(template).map((field) => {
		const boolean = field === 'milestone' || template.tasks.some((t) => typeof t.fields[field] === 'boolean');
		const choices: FieldPolicy[] = boolean || NEVER_EMPTY.has(field) ? ['keep', 'overwrite'] : ['keep', 'overwrite', 'fill_if_empty'];
		return { field, policy: policyFor(field, opts.fieldPolicies), choices };
	});
}

/** A policy in words, as the run options show it: overwrite takes the template's value, its name for `content`. */
export function policyLabel(field: FieldName, policy: FieldPolicy): string {
	if (policy === 'overwrite') return field === 'content' ? 'template name' : 'template';
	return policy === 'keep' ? 'keep' : 'fill if empty';
}

/**
 * The run options in one line, for the collapsed section: the policy most fields take, then each
 * field that differs, e.g. `7 fields: keep · content: template name`. A tie goes to keep, then
 * overwrite.
 */
export function policySummary(views: Array<Pick<PolicyFieldView, 'field' | 'policy'>>): string {
	if (views.length === 0) return 'No field under policy';
	const order: FieldPolicy[] = ['keep', 'overwrite', 'fill_if_empty'];
	const count = (p: FieldPolicy) => views.filter((v) => v.policy === p).length;
	const common = order.reduce((best, p) => (count(p) > count(best) ? p : best), order[0]);
	const head = `${views.length} field${views.length === 1 ? '' : 's'}`;
	if (views.length === 1) return `${head}: ${views[0].field}: ${policyLabel(views[0].field, views[0].policy)}`;
	const odd = views.filter((v) => v.policy !== common).map((v) => `${v.field}: ${policyLabel(v.field, v.policy)}`);
	return [`${head}: ${policyLabel('', common)}`, ...odd].join(' · ');
}

/** The bulk extra actions in one line: how many names, leave by default, then each name set otherwise. */
export function extrasSummary(names: Array<{ name: string; count: number }>, opts: RunOptions): string {
	if (names.length === 0) return 'No extras';
	const odd = names.filter((n) => (opts.extraByName[n.name] ?? 'leave') !== 'leave').map((n) => `${n.name || '(no name)'}: ${opts.extraByName[n.name]}`);
	return [`${names.length} extra name${names.length === 1 ? '' : 's'}: leave`, ...odd].join(' · ');
}

/** Why the pre-pick chose its Task (matching.ts `prePick`), in words. */
export const PICK_REASON: Record<PickReason, string> = {
	only: 'the only candidate',
	usage: 'it has Versions or PublishedFiles',
	status: 'its status moved on from the default',
	oldest: 'the oldest',
	id: 'the lowest id'
};

/** Why a Task is an extra, in words. */
export const EXTRA_REASON: Record<ExtraRow['reason'], string> = {
	not_in_template: 'not in the template',
	link_wins: 'same key, another Task is linked',
	conflict_loser: 'conflict loser: unlinked (106)'
};

/** The stock Omit code (entry.ts). The screen asks for a status only when the project lacks it. */
const STOCK_OMIT = 'omt';

export interface OmitChoice {
	/** The project has no `omt`: the user picks the status omitted Tasks take. */
	ask: boolean;
	statuses: string[];
	current: string;
}

export function omitChoice(ctx: ProjectContext, opts: RunOptions): OmitChoice {
	return { ask: !ctx.validTaskStatuses.includes(STOCK_OMIT), statuses: ctx.validTaskStatuses, current: opts.omitStatus };
}

/** Created Tasks the clear-dates opt-in applies to: no upstream edge and a template date (097). */
export function clearableCreates(plans: EntityPlan[]): number {
	let n = 0;
	for (const p of plans) {
		for (const r of p.rows) {
			if (r.kind === 'create' && r.datesClearable && (r.templateDates.start !== null || r.templateDates.due !== null)) n++;
		}
	}
	return n;
}

export interface PendingDelete {
	entity: EntityPlan['entity'];
	task: EntityTask;
	usage: TaskUsage;
}

/** Every extra set to delete, for the second confirmation (brief 3); those with usage first (089). */
export function pendingDeletes(plans: EntityPlan[]): PendingDelete[] {
	const out: PendingDelete[] = [];
	for (const p of plans) {
		for (const r of p.rows) if (r.kind === 'extra' && r.action === 'delete') out.push({ entity: p.entity, task: r.task, usage: r.usage });
	}
	const used = (d: PendingDelete) => (d.usage.versions + d.usage.publishedFiles > 0 ? 0 : 1);
	return out.sort((a, b) => used(a) - used(b));
}

// ---------------------------------------------------------------------------------------------
// Warnings and blockers
// ---------------------------------------------------------------------------------------------

export type ViewLevel = 'block' | 'warn' | 'info';

export interface ViewWarning {
	code: PlanWarning['code'] | 'unresolved_conflict_row';
	level: ViewLevel;
	text: string;
}

/**
 * The entity's warnings for the list badge and the detail. Renames and delete-with-usage are shown
 * on their rows, so only the entity-level ones are here: template type mismatch, loops, conflicts.
 */
export function entityWarnings(plan: EntityPlan, opts: RunOptions): ViewWarning[] {
	const out: ViewWarning[] = [];
	for (const w of plan.warnings) {
		if (w.code === 'template_entity_type_mismatch') {
			out.push({ code: w.code, level: 'warn', text: `The template is for ${w.templateType ?? 'no type'}; this is a ${w.entityType}. Allowed (083 does not enforce it).` });
		} else if (w.code === 'edge_closes_loop') {
			out.push({ code: w.code, level: 'warn', text: `Keeping edge #${w.edgeId} would close a dependency loop; the server refuses it (085, 107). Removed.` });
		} else if (w.code === 'unresolved_conflict') {
			out.push({ code: w.code, level: 'block', text: `A pick is no longer valid for template tasks ${w.templateTaskIds.map((id) => `#${id}`).join(', ')}. Pick again.` });
		} else if (w.code === 'template_duplicate_key') {
			out.push({ code: w.code, level: 'info', text: `The template has ${w.templateTaskIds.length} tasks with one key: a conflict to resolve.` });
		}
	}
	const open = plan.rows.filter((r): r is ConflictRow => r.kind === 'conflict' && !conflictResolved(r, opts, plan.entity.id)).length;
	if (open > 0) out.push({ code: 'unresolved_conflict_row', level: 'block', text: `${open} conflict${open === 1 ? '' : 's'} to resolve.` });
	return out;
}

/** The `access_short` text: what looks refused, and 094's caveat that the check is partial. */
export function accessWarningText(summary: AccessSummary): string | null {
	if (!summary.looksShort) return null;
	const labels: Record<string, string> = {
		update_task: 'update Tasks',
		update_entity: 'update the entity',
		create_task: 'create Tasks',
		delete_task: 'delete Tasks'
	};
	const caps = summary.checks.filter((c) => c.result === 'refused').map((c) => labels[c.capability]);
	const fields = Object.entries(summary.fields).filter(([, v]) => v === 'refused').map(([f]) => f);
	const parts: string[] = [];
	if (caps.length) parts.push(`cannot ${caps.join(', ')}`);
	if (fields.length) parts.push(`cannot write ${fields.join(', ')}`);
	return (
		`Write access looks short: ${parts.join('; ')}. The corpus measured these refusals as another user ` +
		`(sudo_as, 094), not through a launcher session; a response it does not recognize is left unknown.`
	);
}

export interface EntityFilter {
	/** Entities with at least one row of any of these kinds; empty = any. */
	kinds: PlanKind[];
	warnings: boolean;
	noop: 'all' | 'hide' | 'only';
	text: string;
}

export const NO_FILTER: EntityFilter = { kinds: [], warnings: false, noop: 'all', text: '' };

export function filterPlans(plans: EntityPlan[], filter: EntityFilter, opts: RunOptions): EntityPlan[] {
	const text = filter.text.trim().toLowerCase();
	return plans.filter((p) => {
		if (filter.kinds.length > 0 && !filter.kinds.some((k) => p.counts[k] > 0)) return false;
		if (filter.warnings && entityWarnings(p, opts).length === 0) return false;
		if (filter.noop === 'hide' && p.noop) return false;
		if (filter.noop === 'only' && !p.noop) return false;
		if (text && !(p.entity.name ?? '').toLowerCase().includes(text)) return false;
		return true;
	});
}

/** Why Apply is not offered yet, in the order to fix them; empty when it is. */
export function applyBlockers(
	plans: EntityPlan[],
	opts: RunOptions,
	ctx: ProjectContext,
	access: AccessSummary | null
): string[] {
	const out: string[] = [];
	const conflicts = plans.reduce((n, p) => n + unresolvedConflicts(p, opts), 0);
	if (conflicts > 0) out.push(`${conflicts} conflict${conflicts === 1 ? '' : 's'} to resolve.`);
	if (access?.looksShort) out.push('Write access looks refused.');
	const omits = plans.some((p) => p.rows.some((r) => r.kind === 'extra' && r.action === 'omit'));
	if (omits && !ctx.validTaskStatuses.includes(opts.omitStatus)) out.push('Pick the status omitted Tasks take.');
	const deletes = pendingDeletes(plans).length;
	if (deletes > 0 && !opts.deleteConfirmed) out.push(`Confirm ${deletes} delete${deletes === 1 ? '' : 's'}.`);
	const loops = plans.reduce((n, p) => n + p.edges.affected.filter((a) => a.closesLoop && a.action === 'keep').length, 0);
	if (loops > 0) out.push(`${loops} kept edge${loops === 1 ? '' : 's'} would close a loop: remove ${loops === 1 ? 'it' : 'them'}.`);
	if (plans.length > 0 && plans.every((p) => p.noop)) out.push('Nothing to write.');
	return out;
}

// ---------------------------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------------------------

export interface RowGroups {
	conflict: ConflictRow[];
	keep: KeepRow[];
	claim: ClaimRow[];
	create: CreateRow[];
	extra: ExtraRow[];
}

export function groupRows(rows: PlanRow[]): RowGroups {
	const out: RowGroups = { conflict: [], keep: [], claim: [], create: [], extra: [] };
	for (const r of rows) (out[r.kind] as PlanRow[]).push(r);
	return out;
}

/** The normalized match key as the plan shows it (Kevin): `content @ Step`. */
export function keyLabel(key: MatchKey, step: { name?: string } | null): string {
	const { content, stepId } = keyParts(key);
	const stepName = step?.name ?? (stepId === null ? 'no step' : `step #${stepId}`);
	return `${content || '(empty)'} @ ${stepName}`;
}

/** A field value as text: links by name, lists joined, empty shown as such. */
export function valueLabel(v: unknown): string {
	if (v === null || v === undefined) return '(empty)';
	if (v === '') return '(empty)';
	if (typeof v === 'boolean') return v ? 'yes' : 'no';
	if (Array.isArray(v)) return v.length === 0 ? '(none)' : v.map(valueLabel).join(', ');
	if (typeof v === 'object') {
		const o = v as { name?: unknown; id?: unknown };
		if (typeof o.name === 'string') return o.name;
		if (o.id !== undefined) return `#${o.id}`;
		return JSON.stringify(v);
	}
	return String(v);
}

/**
 * What the apply fills on a Task from its template task (102): always, not under policy. Dates
 * then follow the dependency cascade on a dependent Task (087).
 */
export function fillLabels(fills: FieldFill[] | undefined): string[] {
	const out: string[] = [];
	const get = (f: FieldFill['field']) => fills?.find((x) => x.field === f);
	const assignees = get('task_assignees');
	if (assignees) out.push(`Assignees will be filled from the template: ${valueLabel(assignees.value)}.`);
	const start = get('start_date');
	const due = get('due_date');
	if (start || due)
		out.push(
			`Dates will be filled from the template: ${valueLabel(start?.value)} to ${valueLabel(due?.value)}; a dependency may move them.`
		);
	return out;
}

/** Old link of a claimed Task: which template task, of which template when known (brief 2). */
export function previousLinkLabel(prev: ClaimRow['previousTemplateTask'], templates: Template[]): string {
	if (!prev) return 'not linked';
	const tpl = prev.templateId === null ? undefined : templates.find((t) => t.id === prev.templateId);
	const name = prev.name ?? tpl?.tasks.find((t) => t.id === prev.id)?.content ?? `template task #${prev.id}`;
	return tpl ? `${name} in ${tpl.code}` : `${name} (#${prev.id})`;
}

export interface EdgeEnd {
	label: string;
	created: boolean;
}

export interface AddedEdgeView {
	upstream: EdgeEnd;
	downstream: EdgeEnd;
	type: DependencyType;
	offsetDays: number | null;
	/** The template outline's words, from the downstream side: "after", "starts with"… (outline.ts). */
	phrase: string;
	/** "+2 wd", or null for no offset (105). */
	offset: string | null;
}

export interface AffectedEdgeView {
	id: Id;
	upstream: EdgeEnd;
	downstream: EdgeEnd;
	type: DependencyType;
	offsetDays: number | null;
	phrase: string;
	offset: string | null;
	cause: AffectedEdge['cause'];
	replacedBy: { type: DependencyType; offsetDays: number | null; reversed: boolean; phrase: string; offset: string | null } | null;
	action: EdgeAction;
	/** Why keep is not offered: re-creating it would close a loop (085, 107). */
	keepDisabled: string | null;
}

export interface EdgeView {
	added: AddedEdgeView[];
	affected: AffectedEdgeView[];
	/** Linked Task upstream of a Task outside the template: kept by the apply, shown for information (101, 109). */
	outsideDownstream: AddedEdgeView[];
	mayMove: string[];
	wouldViolate: string[];
}

/** The entity's edges named by their Tasks: existing by `content #id`, created by the template's name. */
export function edgeView(plan: EntityPlan, template: Template, tasks: EntityTask[]): EdgeView {
	const byId = new Map<Id, string>();
	for (const t of tasks) byId.set(t.id, `${t.content ?? '(no name)'} #${t.id}`);
	for (const r of plan.rows) if ('task' in r) byId.set(r.task.id, `${r.task.content ?? '(no name)'} #${r.task.id}`);
	const tplName = new Map(template.tasks.map((t) => [t.id, t.content ?? `template task #${t.id}`]));
	const existing = (id: Id): EdgeEnd => ({ label: byId.get(id) ?? `Task #${id}`, created: false });
	const words = (type: DependencyType, offsetDays: number | null) => ({ phrase: dependencyPhrase(type), offset: offsetLabel(offsetDays) });
	const mapped = (m: MappedTask): EdgeEnd =>
		'existing' in m ? existing(m.existing) : { label: tplName.get(m.created) ?? `template task #${m.created}`, created: true };

	return {
		added: plan.edges.expectedAdded.map((a) => ({
			upstream: mapped(a.upstream),
			downstream: mapped(a.downstream),
			type: a.templateEdge.type,
			offsetDays: a.templateEdge.offsetDays,
			...words(a.templateEdge.type, a.templateEdge.offsetDays)
		})),
		affected: plan.edges.affected.map((a) => ({
			id: a.existing.id,
			upstream: existing(a.existing.upstream),
			downstream: existing(a.existing.downstream),
			type: a.existing.type,
			offsetDays: a.existing.offsetDays,
			...words(a.existing.type, a.existing.offsetDays),
			cause: a.cause,
			replacedBy: a.replacedBy
				? {
						type: a.replacedBy.type,
						offsetDays: a.replacedBy.offsetDays,
						reversed: a.replacedBy.downstream !== a.existing.downstream,
						...words(a.replacedBy.type, a.replacedBy.offsetDays)
					}
				: null,
			action: a.action,
			keepDisabled: a.closesLoop ? 'Keeping it would close a dependency loop: the server refuses it and the batch rolls back (085, 107).' : null
		})),
		outsideDownstream: plan.edges.toExtras.map((e) => ({
			upstream: existing(e.upstream),
			downstream: existing(e.downstream),
			type: e.type,
			offsetDays: e.offsetDays,
			...words(e.type, e.offsetDays)
		})),
		mayMove: plan.edges.mayMove.map((id) => existing(id).label),
		wouldViolate: plan.edges.wouldViolate.map((id) => existing(id).label)
	};
}

export const CAUSE_LABEL: Record<AffectedEdge['cause'], string> = {
	not_in_template: 'not in the template: the apply deletes it (102)',
	replaced: "replaced by the template's edge (101, 102)",
	outside_upstream: 'upstream Task is outside the template: the apply erases it (109)'
};

/** `YYYY-MM-DD`, time left out: the plan file's name. */
export function planCsvName(templateCode: string, now: Date): string {
	const slug = templateCode.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'template';
	return `plan-${slug}-${now.toISOString().slice(0, 10)}.csv`;
}

export const EXTRA_ACTIONS: readonly ExtraAction[] = ['leave', 'omit', 'delete'];
