/**
 * Plan summary: what Apply does, said plainly. Pure, no I/O.
 *
 * - The run summary: a short list of sentences with numbers, grouped by consequence (a choice to
 *   make, Tasks, fields, dependencies and dates, what stays), each with a key that filters the
 *   entity list.
 * - Per entity: one line ("3 linked, 8 created, 1 needs a choice") and its Tasks, each with ONE
 *   outcome from a fixed set, a few markers and the details for the fold.
 *
 * Every state it reads is listed in docs/design.md, "Plan states". An unresolved conflict stands
 * for its candidates and its template tasks: one "needs a choice" line; once picked, they show
 * their resolved outcome with the conflict kept for the picker.
 */

import { sameValue } from './planner';
import {
	EXTRA_REASON,
	PICK_REASON,
	conflictResolved,
	edgeView,
	fillLabels,
	keyLabel,
	policyFieldViews,
	previousLinkLabel,
	valueLabel,
	type EdgeEnd
} from './plan-view';
import type {
	AffectedEdge,
	ConflictRow,
	EntityPlan,
	EntityTask,
	FieldChange,
	FieldName,
	FieldPolicy,
	Id,
	PlanRow,
	RunOptions,
	Template
} from './types';

// ---------------------------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------------------------

/** A field's display name (Task schema read with `project_id`), the code name when it has none. */
export function fieldLabel(labels: Record<FieldName, string> | undefined, field: FieldName): string {
	const name = labels?.[field];
	return name && name.trim() ? name : field;
}

/** A field policy in plain words: short for a button, long for its title and the summary. */
export function policyChoice(policy: FieldPolicy): { short: string; long: string } {
	if (policy === 'keep') return { short: 'Yours', long: 'yours, written back after the apply' };
	if (policy === 'overwrite') return { short: "Template's", long: "the template's" };
	return { short: "Template's if empty", long: "the template's, only where yours is empty" };
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const tasksWord = (n: number) => `${n} ${plural(n, 'Task')}`;
const depsWord = (n: number) => `${n} ${plural(n, 'dependency', 'dependencies')}`;

// ---------------------------------------------------------------------------------------------
// Per Task
// ---------------------------------------------------------------------------------------------

/** One outcome per Task, from a fixed set. `updated`: already linked, the apply changes something. */
export type TaskOutcome = 'needs_choice' | 'deleted' | 'omitted' | 'linked_renamed' | 'linked' | 'created' | 'updated' | 'left' | 'unchanged';

/** Group order in the detail pane: what needs you, then what changes most, then what stays. */
export const OUTCOME_ORDER: readonly TaskOutcome[] = [
	'needs_choice',
	'deleted',
	'omitted',
	'linked_renamed',
	'linked',
	'created',
	'updated',
	'left',
	'unchanged'
];

export const OUTCOME_LABEL: Record<TaskOutcome, string> = {
	needs_choice: 'needs a choice',
	deleted: 'deleted',
	omitted: 'omitted',
	linked_renamed: 'linked + renamed',
	linked: 'linked',
	created: 'created',
	updated: 'updated',
	left: 'not in template',
	unchanged: 'already linked'
};

/** What each outcome means, for the group heading. */
export const OUTCOME_MEANING: Record<TaskOutcome, string> = {
	needs_choice: 'several Tasks match one template task',
	deleted: 'not in the template, deleted; undo revives them',
	omitted: 'not in the template, status set to omit',
	linked_renamed: 'matched by name and Step, linked to the template, renamed to its name',
	linked: 'matched by name and Step, linked to the template',
	created: 'missing on the entity, created from the template',
	updated: 'linked to this template before the apply, a value changes',
	left: 'not in the template, not changed',
	unchanged: 'linked to this template before the apply, nothing changes'
};

export type Tone = 'muted' | 'info' | 'success' | 'warning' | 'destructive';

export type MarkerKey = 'renamed' | 'fields' | 'assignees' | 'dates_filled' | 'dates_move' | 'violation' | 'usage';

export interface Marker {
	key: MarkerKey;
	label: string;
	tone: Tone;
}

export interface Detail {
	text: string;
	tone?: 'warning' | 'destructive';
}

export interface TaskLine {
	/** Stable per entity: `t<task id>`, `c<template task id>` or `k<conflict key>`. */
	id: string;
	outcome: TaskOutcome;
	name: string;
	taskId: Id | null;
	templateTaskId: Id | null;
	status: string | null;
	markers: Marker[];
	details: Detail[];
	/** The plan row it stands for, for the controls (extra action). A conflict line holds its conflict row. */
	row: PlanRow;
	/** The conflict this Task was, or is, part of: the picker lives in its fold. */
	conflict: ConflictRow | null;
}

export interface SummaryInput {
	plans: EntityPlan[];
	options: RunOptions;
	template: Template;
	templates: Template[];
	/** The entity's Tasks by entity id, to name edge ends outside the plan rows. */
	tasks: Record<Id, EntityTask[]>;
	/** For the nouns: "Shots". */
	entityType: string | null;
	/** Field display names by code name (Task schema with `project_id`). */
	labels?: Record<FieldName, string>;
}

const nameOf = (t: { content: string | null }) => (t.content ?? '').trim() || '(no name)';

const changed = (c: FieldChange) => !sameValue(c.result, c.current);

function fieldDetails(changes: FieldChange[] | undefined, labels: SummaryInput['labels']): Detail[] {
	return (changes ?? [])
		.filter((c) => c.field !== 'content')
		.map((c) => {
			const name = fieldLabel(labels, c.field);
			return changed(c)
				? { text: `${name}: ${valueLabel(c.current)} becomes ${valueLabel(c.result)} (the template's).` }
				: { text: `${name}: yours kept (${valueLabel(c.current)}; the template has ${valueLabel(c.template)}).` };
		});
}

const CAUSE_WORDS: Record<AffectedEdge['cause'], string> = {
	not_in_template: 'the template does not have it',
	replaced: "the template's own edge takes its place",
	outside_upstream: 'its upstream is not in the template'
};

/** The Task's side of the entity's edges: what it newly waits on, what it stops waiting on, dates. */
function edgeDetails(plan: EntityPlan, template: Template, tasks: EntityTask[]) {
	const view = edgeView(plan, template, tasks);
	const byNode = new Map<string, Detail[]>();
	const add = (node: string, d: Detail) => byNode.set(node, [...(byNode.get(node) ?? []), d]);
	const node = (m: { existing: Id } | { created: Id }) => ('existing' in m ? `t${m.existing}` : `c${m.created}`);
	const end = (e: EdgeEnd) => (e.created ? `${e.label} (new)` : e.label);
	const words = (phrase: string, offset: string | null) => `${phrase}${offset ? ` ${offset}` : ''}`;
	plan.edges.expectedAdded.forEach((a, i) => {
		const v = view.added[i];
		add(node(a.downstream), { text: `New dependency: ${words(v.phrase, v.offset)} ${end(v.upstream)}.` });
	});
	plan.edges.affected.forEach((a, i) => {
		const v = view.affected[i];
		const then = a.action === 'keep' ? 're-created after the apply' : 'removed';
		add(`t${a.existing.downstream}`, {
			text: `Dependency ${words(v.phrase, v.offset)} ${end(v.upstream)}: the apply removes it (${CAUSE_WORDS[a.cause]}); ${then}.`,
			...(a.closesLoop ? { tone: 'warning' as const } : {})
		});
	});
	for (const id of plan.edges.mayMove) add(`t${id}`, { text: 'Dates may move: a new dependency upstream reschedules it (092).' });
	for (const id of plan.edges.wouldViolate)
		add(`t${id}`, { text: 'Pinned: it keeps its dates and flags a dependency violation (092).', tone: 'warning' });
	return byNode;
}

/** The conflict a row resolved from: its template task, or a candidate that lost. */
function conflictOf(row: PlanRow, conflicts: ConflictRow[]): ConflictRow | null {
	if (row.kind === 'keep' || row.kind === 'claim' || row.kind === 'create')
		return conflicts.find((c) => c.templateTasks.some((tt) => tt.id === row.templateTask.id)) ?? null;
	if (row.kind === 'extra') return conflicts.find((c) => c.candidates.some((x) => x.task.id === row.task.id)) ?? null;
	return null;
}

function isOpen(c: ConflictRow, plan: EntityPlan, opts: RunOptions): boolean {
	if (!conflictResolved(c, opts, plan.entity.id)) return true;
	return plan.warnings.some((w) => w.code === 'unresolved_conflict' && w.templateTaskIds.some((id) => c.templateTasks.some((tt) => tt.id === id)));
}

/** Every Task of one entity, one line each, in plan order. */
export function taskLines(plan: EntityPlan, input: SummaryInput): TaskLine[] {
	const { options: opts, template, templates, labels } = input;
	const conflicts = plan.rows.filter((r): r is ConflictRow => r.kind === 'conflict');
	const open = conflicts.filter((c) => isOpen(c, plan, opts));
	const edges = edgeDetails(plan, template, input.tasks[plan.entity.id] ?? []);
	const mayMove = new Set(plan.edges.mayMove);
	const violate = new Set(plan.edges.wouldViolate);
	const out: TaskLine[] = [];

	const dateMarkers = (taskId: Id): Marker[] => [
		...(mayMove.has(taskId) ? [{ key: 'dates_move' as const, label: 'dates may move', tone: 'info' as const }] : []),
		...(violate.has(taskId) ? [{ key: 'violation' as const, label: 'would flag violation', tone: 'warning' as const }] : [])
	];
	const fillMarkers = (fills: { field: string }[] | undefined): Marker[] => [
		...(fills?.some((f) => f.field === 'task_assignees') ? [{ key: 'assignees' as const, label: 'assignees filled', tone: 'muted' as const }] : []),
		...(fills?.some((f) => f.field !== 'task_assignees') ? [{ key: 'dates_filled' as const, label: 'dates filled', tone: 'muted' as const }] : [])
	];
	const fillDetails = (fills: Parameters<typeof fillLabels>[0]): Detail[] => fillLabels(fills).map((text) => ({ text }));
	const conflictDetail = (c: ConflictRow | null): Detail[] =>
		c ? [{ text: `Picked: ${c.candidates.length} Tasks match ${keyLabel(c.key, c.templateTasks[0]?.step ?? null)}.` }] : [];

	for (const row of plan.rows) {
		if (row.kind === 'conflict') {
			if (!open.includes(row)) continue;
			const pre = row.candidates.find((c) => Object.values(row.prePick).includes(c.task.id));
			const key = keyLabel(row.key, row.templateTasks[0]?.step ?? null);
			const twice = row.templateTasks.length > 1 ? `, and the template has it ${row.templateTasks.length} times` : '';
			out.push({
				id: `k${row.key}`,
				outcome: 'needs_choice',
				name: nameOf(row.templateTasks[0] ?? { content: null }),
				taskId: null,
				templateTaskId: row.templateTasks[0]?.id ?? null,
				status: null,
				markers: [],
				details: [
					{ text: `${row.candidates.length} Tasks match ${key}${twice}: pick the one the template task takes, or create a new one.` },
					...(pre ? [{ text: `Pre-pick: ${nameOf(pre.task)} #${pre.task.id}, ${PICK_REASON[row.reason]}.` }] : [])
				],
				row,
				conflict: row
			});
			continue;
		}
		const conflict = conflictOf(row, conflicts);
		if (conflict && open.includes(conflict)) continue; // the needs-a-choice line stands for it

		if (row.kind === 'keep' || row.kind === 'claim') {
			const fields = row.fieldChanges.some((c) => c.field !== 'content' && changed(c));
			const markers: Marker[] = [];
			const details: Detail[] = [];
			let outcome: TaskOutcome;
			if (row.kind === 'claim') {
				outcome = row.rename ? 'linked_renamed' : 'linked';
				details.push({ text: `Same name and step (${keyLabel(row.task.key, row.task.step)}): linked to ${nameOf(row.templateTask)} in ${template.code}.` });
				details.push({
					text: row.previousTemplateTask ? `Linked before: ${previousLinkLabel(row.previousTemplateTask, templates)}.` : 'Not linked to a template before.'
				});
				if (row.rename) details.push({ text: `Renamed: ${nameOf({ content: row.rename.from })} to ${nameOf({ content: row.rename.to })}.` });
			} else {
				outcome = row.rename || fields || row.fills?.length ? 'updated' : 'unchanged';
				details.push({ text: `Already linked to ${nameOf(row.templateTask)} in ${template.code}.` });
				if (row.keyMismatch)
					details.push({ text: `Its name or step no longer match the template task (${keyLabel(row.task.key, row.task.step)}); it stays linked.` });
				if (row.rename) {
					markers.push({ key: 'renamed', label: 'renamed back', tone: 'warning' });
					details.push({
						text: `Renamed by hand: gets the template name back, ${nameOf({ content: row.rename.from })} to ${nameOf({ content: row.rename.to })}.`,
						tone: 'warning'
					});
				}
			}
			if (fields) markers.push({ key: 'fields', label: 'fields change', tone: 'info' });
			markers.push(...fillMarkers(row.fills), ...dateMarkers(row.task.id));
			details.push(...fieldDetails(row.fieldChanges, labels), ...fillDetails(row.fills), ...(edges.get(`t${row.task.id}`) ?? []), ...conflictDetail(conflict));
			out.push({
				id: `t${row.task.id}`,
				outcome,
				name: nameOf(row.task),
				taskId: row.task.id,
				templateTaskId: row.templateTask.id,
				status: row.task.status,
				markers,
				details,
				row,
				conflict
			});
		} else if (row.kind === 'create') {
			const { start, due } = row.templateDates;
			const details: Detail[] = [{ text: `New Task from the template's ${nameOf(row.templateTask)}, with its fields.` }];
			if (start !== null || due !== null) {
				if (row.datesClearable && opts.clearCreatedDates) details.push({ text: 'Template dates cleared: it starts with no dates.' });
				else
					details.push({
						text: `Template dates: ${start ?? '(none)'} to ${due ?? '(none)'}.${row.datesClearable ? '' : ' Its upstream dependency may move them.'}`
					});
			}
			details.push(...(edges.get(`c${row.templateTask.id}`) ?? []), ...conflictDetail(conflict));
			out.push({
				id: `c${row.templateTask.id}`,
				outcome: 'created',
				name: nameOf(row.templateTask),
				taskId: null,
				templateTaskId: row.templateTask.id,
				status: row.templateTask.status,
				markers: [],
				details,
				row,
				conflict
			});
		} else if (row.kind === 'extra') {
			const used = row.usage.versions + row.usage.publishedFiles > 0;
			const outcome: TaskOutcome = row.action === 'delete' ? 'deleted' : row.action === 'omit' ? 'omitted' : 'left';
			const unlinked =
				row.reason === 'conflict_loser' && !!row.task.templateTask && !!conflict?.templateTasks.some((tt) => tt.id === row.task.templateTask?.id);
			const details: Detail[] = [];
			if (row.reason === 'not_in_template') details.push({ text: 'Not in the template.' });
			else if (row.reason === 'link_wins') details.push({ text: `Same name and step as a template task: ${EXTRA_REASON.link_wins}.` });
			else
				details.push({
					text: unlinked ? 'Not picked. Unlinked from the template task so only the picked Task is linked (106).' : 'Not picked.'
				});
			if (outcome === 'left') details.push({ text: 'Left as it is.' });
			if (outcome === 'omitted') details.push({ text: `Status ${row.task.status ?? '(none)'} becomes ${opts.omitStatus || 'the omit status (pick one)'}.` });
			if (outcome === 'deleted')
				details.push({
					text: `Deleted${opts.deleteConfirmed ? '' : ' once you confirm'}. Its ${row.usage.versions} Versions and ${row.usage.publishedFiles} PublishedFiles lose their Task link; undo revives it.`,
					...(used ? { tone: 'destructive' as const } : {})
				});
			const markers: Marker[] = [];
			if (outcome === 'deleted' && used)
				markers.push({ key: 'usage', label: `${row.usage.versions} Versions, ${row.usage.publishedFiles} PublishedFiles`, tone: 'destructive' });
			const relinked = !unlinked && row.fieldChanges !== undefined;
			if (relinked) {
				if (row.fieldChanges!.some((c) => changed(c))) markers.push({ key: 'fields', label: 'fields change', tone: 'info' });
				markers.push(...fillMarkers(row.fills));
				details.push({ text: 'Still linked to a template task: the apply re-syncs it too.' }, ...fieldDetails(row.fieldChanges, labels), ...fillDetails(row.fills));
			}
			markers.push(...dateMarkers(row.task.id));
			details.push(...(edges.get(`t${row.task.id}`) ?? []), ...conflictDetail(conflict));
			out.push({
				id: `t${row.task.id}`,
				outcome,
				name: nameOf(row.task),
				taskId: row.task.id,
				templateTaskId: null,
				status: row.task.status,
				markers,
				details,
				row,
				conflict
			});
		}
	}
	return out;
}

// ---------------------------------------------------------------------------------------------
// Per entity
// ---------------------------------------------------------------------------------------------

/** What the run summary counts; each is also a filter on the entity list. */
export type SummaryKey =
	| 'needs_choice'
	| 'mismatch'
	| 'loop'
	| 'deleted'
	| 'omitted'
	| 'created'
	| 'linked'
	| 'renamed'
	| 'policy'
	| 'fields'
	| 'filled'
	| 'deps_added'
	| 'deps_removed'
	| 'deps_recreated'
	| 'dates_move'
	| 'violation'
	| 'left'
	| 'unchanged'
	| 'noop';

export const SUMMARY_KEYS: readonly SummaryKey[] = [
	'needs_choice',
	'mismatch',
	'loop',
	'deleted',
	'omitted',
	'created',
	'linked',
	'renamed',
	'policy',
	'fields',
	'filled',
	'deps_added',
	'deps_removed',
	'deps_recreated',
	'dates_move',
	'violation',
	'left',
	'unchanged',
	'noop'
];

export type SummaryGroup = 'attention' | 'tasks' | 'fields' | 'dependencies' | 'same';

export const SUMMARY_GROUP: Record<SummaryKey, SummaryGroup> = {
	needs_choice: 'attention',
	mismatch: 'attention',
	loop: 'attention',
	deleted: 'tasks',
	omitted: 'tasks',
	created: 'tasks',
	linked: 'tasks',
	renamed: 'tasks',
	policy: 'fields',
	fields: 'fields',
	filled: 'fields',
	deps_added: 'dependencies',
	deps_removed: 'dependencies',
	deps_recreated: 'dependencies',
	dates_move: 'dependencies',
	violation: 'dependencies',
	left: 'same',
	unchanged: 'same',
	noop: 'same'
};

export const GROUP_LABEL: Record<SummaryGroup, string> = {
	attention: 'Check first',
	tasks: 'Tasks',
	fields: 'Fields',
	dependencies: 'Dependencies and dates',
	same: 'Stays as it is'
};

export interface TaskGroup {
	outcome: TaskOutcome;
	label: string;
	meaning: string;
	lines: TaskLine[];
}

export interface EntitySummary {
	entityId: Id;
	tally: Record<SummaryKey, number>;
	/** Deletes of Tasks with Versions or PublishedFiles, for the sentence. */
	deletedUsed: number;
	outcomes: Record<TaskOutcome, number>;
	/** "3 linked, 8 created, 1 needs a choice". */
	line: string;
	groups: TaskGroup[];
}

const zeroTally = (): Record<SummaryKey, number> => Object.fromEntries(SUMMARY_KEYS.map((k) => [k, 0])) as Record<SummaryKey, number>;

/** Entity line order: Kevin's "3 linked, 8 created, 1 needs a choice". */
const LINE_ORDER: TaskOutcome[] = ['linked', 'created', 'updated', 'omitted', 'deleted', 'left', 'unchanged', 'needs_choice'];

export function entitySummary(plan: EntityPlan, input: SummaryInput): EntitySummary {
	const lines = taskLines(plan, input);
	const outcomes = Object.fromEntries(OUTCOME_ORDER.map((o) => [o, 0])) as Record<TaskOutcome, number>;
	for (const l of lines) outcomes[l.outcome]++;
	const has = (l: TaskLine, k: TaskLine['markers'][number]['key']) => l.markers.some((m) => m.key === k);

	const tally = zeroTally();
	tally.needs_choice = outcomes.needs_choice;
	tally.mismatch = plan.warnings.some((w) => w.code === 'template_entity_type_mismatch') ? 1 : 0;
	tally.loop = plan.edges.affected.filter((a) => a.closesLoop).length;
	tally.deleted = outcomes.deleted;
	tally.omitted = outcomes.omitted;
	tally.created = outcomes.created;
	tally.linked = outcomes.linked + outcomes.linked_renamed;
	tally.renamed = lines.filter((l) => l.outcome === 'linked_renamed' || has(l, 'renamed')).length;
	tally.policy = lines.filter((l) => l.row.kind === 'keep' || l.row.kind === 'claim').length;
	tally.fields = lines.filter((l) => has(l, 'fields')).length;
	tally.filled = lines.filter((l) => has(l, 'assignees') || has(l, 'dates_filled')).length;
	tally.deps_added = plan.edges.expectedAdded.length;
	tally.deps_removed = plan.edges.affected.filter((a) => a.action === 'remove').length;
	tally.deps_recreated = plan.edges.affected.filter((a) => a.action === 'keep').length;
	tally.dates_move = plan.edges.mayMove.length;
	tally.violation = plan.edges.wouldViolate.length;
	tally.left = outcomes.left;
	tally.unchanged = outcomes.unchanged;
	tally.noop = plan.noop ? 1 : 0;

	const merged = { ...outcomes, linked: outcomes.linked + outcomes.linked_renamed };
	const parts = LINE_ORDER.filter((o) => merged[o] > 0).map((o) =>
		o === 'needs_choice' ? `${merged[o]} ${plural(merged[o], 'needs', 'need')} a choice` : `${merged[o]} ${OUTCOME_LABEL[o]}`
	);
	const line = [plan.noop ? 'Nothing to write' : null, parts.join(', ') || null].filter(Boolean).join(' · ') || 'No Tasks';

	const groups = OUTCOME_ORDER.map((outcome) => ({
		outcome,
		label: OUTCOME_LABEL[outcome],
		meaning: OUTCOME_MEANING[outcome],
		lines: lines.filter((l) => l.outcome === outcome)
	})).filter((g) => g.lines.length > 0);

	const deletedUsed = lines.filter((l) => l.outcome === 'deleted' && has(l, 'usage')).length;
	return { entityId: plan.entity.id, tally, deletedUsed, outcomes, line, groups };
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

export interface SummaryLine {
	key: SummaryKey;
	group: SummaryGroup;
	count: number;
	/** Entities it touches. */
	entities: number;
	text: string;
	/** "on 3 of 12 Shots"; empty on a one-entity run or where it does not apply. */
	where: string;
	tone: Tone;
}

export interface PlanSummary {
	lines: SummaryLine[];
	entities: Record<Id, EntitySummary>;
}

const TONE: Record<SummaryKey, Tone> = {
	needs_choice: 'destructive',
	mismatch: 'warning',
	loop: 'warning',
	deleted: 'destructive',
	omitted: 'warning',
	created: 'success',
	linked: 'info',
	renamed: 'warning',
	policy: 'muted',
	fields: 'info',
	filled: 'muted',
	deps_added: 'info',
	deps_removed: 'warning',
	deps_recreated: 'muted',
	dates_move: 'info',
	violation: 'warning',
	left: 'muted',
	unchanged: 'muted',
	noop: 'muted'
};

/** Fields under policy in one sentence: the policy most take, then each field that differs. */
export function policyWords(views: Array<{ field: FieldName; policy: FieldPolicy }>, labels: SummaryInput['labels']): string {
	const order: FieldPolicy[] = ['keep', 'overwrite', 'fill_if_empty'];
	const count = (p: FieldPolicy) => views.filter((v) => v.policy === p).length;
	const common = order.reduce((best, p) => (count(p) > count(best) ? p : best), order[0]);
	const COMMON: Record<FieldPolicy, string> = {
		keep: 'your values kept',
		overwrite: "the template's values",
		fill_if_empty: "the template's where yours are empty"
	};
	const ODD: Record<FieldPolicy, string> = { keep: 'yours', overwrite: "the template's", fill_if_empty: "the template's if empty" };
	const odd = views.filter((v) => v.policy !== common).map((v) => `${fieldLabel(labels, v.field)}: ${ODD[v.policy]}`);
	return `${COMMON[common]}${odd.length ? `, except ${odd.join(', ')}` : ''}`;
}

export function planSummary(input: SummaryInput): PlanSummary {
	const { plans, options: opts } = input;
	const entities: Record<Id, EntitySummary> = {};
	for (const p of plans) entities[p.entity.id] = entitySummary(p, input);
	const all = Object.values(entities);
	const total = plans.length;
	const type = input.entityType ?? 'entity';
	const noun = (n: number) => (n === 1 ? type : input.entityType ? `${type}s` : 'entities');

	const sum = (k: SummaryKey) => all.reduce((n, e) => n + e.tally[k], 0);
	const touched = (k: SummaryKey) => all.filter((e) => e.tally[k] > 0).length;
	const whereOf = (m: number) => {
		if (total <= 1) return '';
		if (m === total) return total === 2 ? `on both ${noun(2)}` : `on all ${total} ${noun(total)}`;
		return `on ${m} of ${total} ${noun(total)}`;
	};

	const deletedUsed = all.reduce((n, e) => n + e.deletedUsed, 0);
	const mismatch = plans.flatMap((p) => p.warnings).find((w) => w.code === 'template_entity_type_mismatch');
	const views = policyFieldViews(input.template, opts);

	const text: Record<SummaryKey, (n: number) => string> = {
		needs_choice: (n) => `${n} ${plural(n, 'needs', 'need')} a choice: several Tasks match one template task`,
		mismatch: (n) =>
			`The template is for ${mismatch && mismatch.code === 'template_entity_type_mismatch' ? (mismatch.templateType ?? 'no type') : 'another type'}; applied to ${n} ${noun(n)} anyway`,
		loop: (n) => `${depsWord(n)} would close a loop: removed`,
		deleted: (n) =>
			`${tasksWord(n)} deleted${deletedUsed ? `, ${deletedUsed} with Versions or PublishedFiles` : ''}${opts.deleteConfirmed ? '' : ' (to confirm)'}`,
		omitted: (n) => `${tasksWord(n)} not in the template set to ${opts.omitStatus || 'the omit status'}`,
		created: (n) => `${n} new ${plural(n, 'Task')} created from the template`,
		linked: (n) => `${n} existing ${plural(n, 'Task')} matched by name and Step, linked to the template`,
		renamed: (n) => `${tasksWord(n)} renamed to the template's name`,
		policy: (n) => `${views.length} template ${plural(views.length, 'field')} on ${n} existing ${plural(n, 'Task')}: ${policyWords(views, input.labels)}`,
		fields: (n) => `Field values change on ${tasksWord(n)}`,
		filled: (n) => `Assignees or dates filled from the template on ${tasksWord(n)} that had none`,
		deps_added: (n) => `${depsWord(n)} added`,
		deps_removed: (n) => `${depsWord(n)} removed`,
		deps_recreated: (n) => `${depsWord(n)} removed by the apply, re-created after it`,
		dates_move: (n) => `Dates may move on ${tasksWord(n)}`,
		violation: (n) => `${n} pinned ${plural(n, 'Task')} would flag a dependency violation`,
		left: (n) => `${tasksWord(n)} not in the template, not changed`,
		unchanged: (n) => `${tasksWord(n)} already linked, nothing changes`,
		noop: (n) => `${n} ${noun(n)} already ${plural(n, 'matches', 'match')}: nothing to write`
	};
	const noWhere = new Set<SummaryKey>(['mismatch', 'noop']);

	const lines: SummaryLine[] = [];
	for (const key of SUMMARY_KEYS) {
		const count = sum(key);
		if (count === 0) continue;
		if (key === 'policy' && views.length === 0) continue;
		const entitiesTouched = touched(key);
		lines.push({
			key,
			group: SUMMARY_GROUP[key],
			count,
			entities: entitiesTouched,
			text: text[key](key === 'mismatch' || key === 'noop' ? entitiesTouched : count),
			where: noWhere.has(key) ? '' : whereOf(entitiesTouched),
			tone: TONE[key]
		});
	}
	return { lines, entities };
}

/** The entity list filter: entities the summary line counts; `null` = all. */
export function matchesKey(summary: EntitySummary | undefined, key: SummaryKey | null): boolean {
	if (key === null) return true;
	return (summary?.tally[key] ?? 0) > 0;
}

