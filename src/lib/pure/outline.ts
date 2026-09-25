/**
 * The template screen's preview: the template's tasks grouped by step, each with the tasks it
 * waits on, in words. Pure, no I/O.
 *
 * An edge's `downstream` is `TaskDependency.task` and `upstream` its `dependent_task` (085); the
 * phrase reads from the downstream side ("Anim starts with Layout", then "+2 wd"). `offset_days` is
 * in working days and may be negative; null and 0 are different to the server (105), so 0 prints.
 */

import type { DependencyType, Id, Template } from './types';

export interface OutlineEdge {
	id: Id | null;
	upstream: string;
	/** The type in words: "after", "starts with"… */
	phrase: string;
	/** The signed working-day offset, "+2 wd"; null when the edge has none. */
	offset: string | null;
}

export interface OutlineTask {
	id: Id;
	name: string;
	sortOrder: number | null;
	duration: number | null;
	estInMins: number | null;
	milestone: boolean;
	/** The tasks this one waits on, in the template's edge order. */
	after: OutlineEdge[];
	/** How many tasks wait on this one. */
	feeds: number;
}

export interface OutlineGroup {
	stepId: Id | null;
	step: string;
	tasks: OutlineTask[];
}

export interface TemplateOutline {
	groups: OutlineGroup[];
	taskCount: number;
	edgeCount: number;
}

const PHRASE: Record<DependencyType, string> = {
	'finish-to-start-next-day': 'after',
	'start-to-start': 'starts with',
	'finish-to-finish': 'finishes with',
	'start-to-finish-next-day': 'finishes after start of'
};

/** The dependency type in words, from the downstream task's side. */
export function dependencyPhrase(type: DependencyType): string {
	return PHRASE[type] ?? type;
}

/** The offset in working days, signed; null for none. 0 prints: it differs from null (105). */
export function offsetLabel(offsetDays: number | null): string | null {
	if (offsetDays === null) return null;
	return `${offsetDays < 0 ? '−' : '+'}${Math.abs(offsetDays)} wd`;
}

export function templateOutline(template: Template): TemplateOutline {
	const names = new Map(template.tasks.map((t) => [t.id, t.content || `Task ${t.id}`]));
	const name = (id: Id) => names.get(id) ?? `Task ${id}`;
	const after = new Map<Id, OutlineEdge[]>();
	const feeds = new Map<Id, number>();
	for (const e of template.edges) {
		after.set(e.downstream, [...(after.get(e.downstream) ?? []), { id: e.id, upstream: name(e.upstream), phrase: dependencyPhrase(e.type), offset: offsetLabel(e.offsetDays) }]);
		feeds.set(e.upstream, (feeds.get(e.upstream) ?? 0) + 1);
	}
	const groups = new Map<string, OutlineGroup>();
	for (const t of template.tasks) {
		const key = t.step ? `s${t.step.id}` : 'none';
		let group = groups.get(key);
		if (!group) {
			group = { stepId: t.step?.id ?? null, step: t.step ? (t.step.name ?? `Step ${t.step.id}`) : 'No step', tasks: [] };
			groups.set(key, group);
		}
		group.tasks.push({
			id: t.id,
			name: name(t.id),
			sortOrder: t.sortOrder,
			duration: t.duration,
			estInMins: t.estInMins,
			milestone: t.milestone,
			after: after.get(t.id) ?? [],
			feeds: feeds.get(t.id) ?? 0
		});
	}
	return { groups: [...groups.values()], taskCount: template.tasks.length, edgeCount: template.edges.length };
}
