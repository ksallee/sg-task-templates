/**
 * What changed on an entity between two reads: the plan's snapshot against the read just before the
 * write (changed since the plan), or the read before a write against the read after it (what the
 * write left on Flow PT). Pure, no I/O.
 *
 * Compared: the entity's template; each Task's presence, name, Step, template link, status,
 * assignees and fields under policy; each TaskDependency row's ends, type and offset. Not
 * compared: dates, pins and the violation flag (another entity of the same run moves them by
 * cascade, 087, 092) and Version or PublishedFile counts (they change the plan's warnings only).
 */

import { sameValue } from './planner';
import type { Edge, EntityRef, EntitySnapshot, EntityTask, Id } from './types';

export interface TaskName {
	id: Id;
	name: string;
}

export type SnapshotChange =
	| { code: 'template'; from: EntityRef | null; to: EntityRef | null }
	| { code: 'task_added'; task: TaskName }
	| { code: 'task_removed'; task: TaskName }
	/** Field names as the API spells them: content, step, template_task, sg_status_list, task_assignees, then fields under policy. */
	| { code: 'task_changed'; task: TaskName; fields: string[] }
	| { code: 'edge_added' | 'edge_removed' | 'edge_changed'; downstream: TaskName; upstream: TaskName };

/** What the comparison reads: a snapshot, or the tasks and edges of a read-back. */
export type Reading = Pick<EntitySnapshot, 'tasks' | 'edges'> & { entity?: Pick<EntitySnapshot['entity'], 'taskTemplate'> };

const DATES = new Set(['start_date', 'due_date']);

const nameOf = (t: EntityTask): TaskName => ({ id: t.id, name: (t.content ?? '').trim() || '(no name)' });

function taskFields(a: EntityTask, b: EntityTask): string[] {
	const out: string[] = [];
	if ((a.content ?? '') !== (b.content ?? '')) out.push('content');
	if ((a.step?.id ?? null) !== (b.step?.id ?? null)) out.push('step');
	if ((a.templateTask?.id ?? null) !== (b.templateTask?.id ?? null)) out.push('template_task');
	if (a.status !== b.status) out.push('sg_status_list');
	if (!sameValue(a.assignees, b.assignees)) out.push('task_assignees');
	const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
	for (const k of keys) {
		if (k === 'content' || DATES.has(k) || out.includes(k)) continue;
		if (!sameValue(a.fields[k], b.fields[k])) out.push(k);
	}
	return out;
}

export function snapshotChanges(from: Reading, to: Reading): SnapshotChange[] {
	const out: SnapshotChange[] = [];
	const was = from.entity?.taskTemplate ?? null;
	const is = to.entity?.taskTemplate ?? null;
	if (from.entity && to.entity && (was?.id ?? null) !== (is?.id ?? null)) out.push({ code: 'template', from: was, to: is });

	const before = new Map(from.tasks.map((t) => [t.id, t]));
	const after = new Map(to.tasks.map((t) => [t.id, t]));
	const names = new Map<Id, TaskName>();
	for (const t of [...from.tasks, ...to.tasks]) names.set(t.id, nameOf(t));
	const name = (id: Id): TaskName => names.get(id) ?? { id, name: `Task ${id}` };

	for (const t of to.tasks) if (!before.has(t.id)) out.push({ code: 'task_added', task: nameOf(t) });
	for (const t of from.tasks) if (!after.has(t.id)) out.push({ code: 'task_removed', task: nameOf(t) });
	for (const t of to.tasks) {
		const b = before.get(t.id);
		if (!b) continue;
		const fields = taskFields(b, t);
		if (fields.length) out.push({ code: 'task_changed', task: nameOf(t), fields });
	}

	const rows = (edges: Edge[]) => new Map(edges.filter((e) => e.id !== null).map((e) => [e.id as Id, e]));
	const eBefore = rows(from.edges);
	const eAfter = rows(to.edges);
	const ends = (e: Edge) => ({ downstream: name(e.downstream), upstream: name(e.upstream) });
	for (const [id, e] of eAfter) if (!eBefore.has(id)) out.push({ code: 'edge_added', ...ends(e) });
	for (const [id, e] of eBefore) if (!eAfter.has(id)) out.push({ code: 'edge_removed', ...ends(e) });
	for (const [id, e] of eAfter) {
		const b = eBefore.get(id);
		if (b && (b.downstream !== e.downstream || b.upstream !== e.upstream || b.type !== e.type || b.offsetDays !== e.offsetDays))
			out.push({ code: 'edge_changed', ...ends(e) });
	}
	return out;
}

const FIELD_WORD: Record<string, string> = {
	content: 'name',
	step: 'Pipeline Step',
	template_task: 'template task',
	sg_status_list: 'status',
	task_assignees: 'assignees'
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const label = (t: TaskName) => `${t.name} #${t.id}`;
const templateName = (t: EntityRef | null) => (t ? (t.name ?? `template #${t.id}`) : 'none');

/** The changes as sentences, each kind once. `labels`: display names of fields under policy, by API name (the schema's). */
export function describeChanges(changes: SnapshotChange[], labels: Record<string, string> | ((f: string) => string) = {}): string[] {
	const out: string[] = [];
	const given = (f: string) => (typeof labels === 'function' ? labels(f) : labels[f])?.trim();
	const field = (f: string) => {
		const g = given(f);
		return g && g !== f ? g : (FIELD_WORD[f] ?? f);
	};
	for (const c of changes)
		if (c.code === 'template')
			out.push(c.from ? `Template ${templateName(c.from)} changed to ${templateName(c.to)}.` : `Template set to ${templateName(c.to)}.`);
	const added = changes.flatMap((c) => (c.code === 'task_added' ? [c.task] : []));
	const removed = changes.flatMap((c) => (c.code === 'task_removed' ? [c.task] : []));
	if (added.length) out.push(`${plural(added.length, 'Task', 'Tasks')} created: ${added.map(label).join(', ')}.`);
	if (removed.length) out.push(`${plural(removed.length, 'Task', 'Tasks')} deleted: ${removed.map(label).join(', ')}.`);
	for (const c of changes) if (c.code === 'task_changed') out.push(`${label(c.task)}: ${c.fields.map(field).join(', ')}.`);
	const edges = (code: SnapshotChange['code']) => changes.filter((c) => c.code === code).length;
	const parts = [
		[edges('edge_added'), 'added'],
		[edges('edge_removed'), 'removed'],
		[edges('edge_changed'), 'changed']
	].filter(([n]) => (n as number) > 0) as Array<[number, string]>;
	if (parts.length)
		out.push(`${parts.map(([n, word], i) => (i === 0 ? `${plural(n, 'dependency', 'dependencies')} ${word}` : `${n} ${word}`)).join(', ')}.`);
	return out;
}
