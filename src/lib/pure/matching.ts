/**
 * Matching: which entity Task stands for which template task. Pure, no I/O.
 *
 * Key = normalized `content` + step id (brief 2, recipe 015, Q-D). A Task linked through
 * `template_task` to a task of this template belongs to that task whatever its key (084: the
 * server matches by link), and the link wins over same-key Tasks (decisions). Two Tasks for one
 * template task, or a template with two tasks of one key (Q-E), is a conflict the user resolves,
 * with a pre-pick.
 */

import type {
	EntityTask,
	Id,
	Match,
	MatchConflict,
	MatchKey,
	MatchKeyParts,
	PrePick,
	PickReason,
	TaskUsage,
	Template,
	TemplateTask
} from './types';

/** NFC, trim, collapse inner whitespace runs to one space, casefold. null -> "". */
export function normalizeContent(content: string | null): string {
	if (content === null) return '';
	return content.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFC');
}

const NO_STEP = '-';

/** `<step id or ->|<normalized content>`: the step comes first so any content parses back. */
export function matchKey(content: string | null, stepId: Id | null): MatchKey {
	return `${stepId === null ? NO_STEP : stepId}|${normalizeContent(content)}` as MatchKey;
}

export function keyParts(key: MatchKey): MatchKeyParts {
	const at = key.indexOf('|');
	const step = key.slice(0, at);
	return { content: key.slice(at + 1), stepId: step === NO_STEP ? null : Number(step) };
}

function byTemplateOrder(a: TemplateTask, b: TemplateTask): number {
	if (a.sortOrder !== b.sortOrder) {
		if (a.sortOrder === null) return 1;
		if (b.sortOrder === null) return -1;
		return a.sortOrder - b.sortOrder;
	}
	return a.id - b.id;
}

/** Template task id this Task is linked to, when that task belongs to `template`. */
function linkedTo(task: EntityTask, ids: Set<Id>): Id | null {
	const link = task.templateTask?.id;
	return link !== undefined && ids.has(link) ? link : null;
}

/**
 * Candidates per template task id: the Tasks linked to it, plus every same-key Task not linked to
 * a task of this template. A Task linked to another template's task is a plain candidate.
 */
export function candidatesFor(template: Template, tasks: EntityTask[]): Map<Id, EntityTask[]> {
	const ids = new Set(template.tasks.map((t) => t.id));
	const out = new Map<Id, EntityTask[]>();
	for (const tt of template.tasks) {
		out.set(
			tt.id,
			tasks.filter((t) => {
				const link = linkedTo(t, ids);
				return link === null ? t.key === tt.key : link === tt.id;
			})
		);
	}
	return out;
}

const hasUsage = (u: TaskUsage | undefined) => !!u && (u.versions > 0 || u.publishedFiles > 0);

/**
 * Order candidates best first: has Versions or Published Files; then a status other than the
 * project default (null counts as default); then oldest `created_at`; then lowest id. `reason`
 * is the first criterion that separated the top two.
 */
export function prePick(
	candidates: EntityTask[],
	usage: Record<Id, TaskUsage>,
	defaultStatus: string
): PrePick {
	if (candidates.length === 0) throw new Error('prePick: no candidate');
	const criteria: Array<[Exclude<PickReason, 'only'>, (a: EntityTask, b: EntityTask) => number]> = [
		['usage', (a, b) => Number(hasUsage(usage[b.id])) - Number(hasUsage(usage[a.id]))],
		['status', (a, b) => Number(worked(b)) - Number(worked(a))],
		['oldest', (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)],
		['id', (a, b) => a.id - b.id]
	];
	function worked(t: EntityTask): boolean {
		return t.status !== null && t.status !== defaultStatus;
	}
	const compare = (a: EntityTask, b: EntityTask) => {
		for (const [, c] of criteria) {
			const d = c(a, b);
			if (d !== 0) return d;
		}
		return 0;
	};
	const order = [...candidates].sort(compare);
	let reason: PickReason = 'only';
	if (order.length > 1) {
		reason = criteria.find(([, c]) => c(order[0], order[1]) !== 0)?.[0] ?? 'id';
	}
	return { order, pick: order[0].id, reason };
}

/**
 * Match one entity's Tasks against a template.
 *
 * Per key: Tasks linked to a template task bind to it (keep; two on one task = conflict). The
 * key's other template tasks R and its unlinked Tasks U then resolve as: U empty -> create R;
 * R empty -> U are extras (`link_wins`); one of each -> claim; otherwise a conflict whose pre-pick
 * gives the best candidates to R in template order. Tasks with no template key are extras.
 */
export function matchEntity(
	template: Template,
	tasks: EntityTask[],
	usage: Record<Id, TaskUsage>,
	defaultStatus: string
): Match {
	const ids = new Set(template.tasks.map((t) => t.id));
	const sorted = [...template.tasks].sort(byTemplateOrder);
	const match: Match = { keep: [], claim: [], create: [], extra: [], conflict: [] };

	const linked = new Map<Id, EntityTask[]>();
	const unlinkedByKey = new Map<MatchKey, EntityTask[]>();
	for (const t of tasks) {
		const link = linkedTo(t, ids);
		if (link !== null) linked.set(link, [...(linked.get(link) ?? []), t]);
		else unlinkedByKey.set(t.key, [...(unlinkedByKey.get(t.key) ?? []), t]);
	}

	const groups = new Map<MatchKey, TemplateTask[]>();
	for (const tt of sorted) groups.set(tt.key, [...(groups.get(tt.key) ?? []), tt]);

	for (const [key, group] of groups) {
		const free: TemplateTask[] = [];
		for (const tt of group) {
			const own = linked.get(tt.id) ?? [];
			if (own.length === 0) free.push(tt);
			else if (own.length === 1) {
				match.keep.push({ templateTaskId: tt.id, taskId: own[0].id, keyMismatch: own[0].key !== tt.key });
			} else {
				match.conflict.push(conflictOf(tt.key, [tt], own, usage, defaultStatus));
			}
		}
		const unlinked = unlinkedByKey.get(key) ?? [];
		if (unlinked.length === 0) match.create.push(...free.map((tt) => tt.id));
		else if (free.length === 0) {
			match.extra.push(...unlinked.map((t) => ({ taskId: t.id, reason: 'link_wins' as const })));
		} else if (free.length === 1 && unlinked.length === 1) {
			match.claim.push({ templateTaskId: free[0].id, taskId: unlinked[0].id });
		} else {
			match.conflict.push(conflictOf(key, free, unlinked, usage, defaultStatus));
		}
	}

	for (const [key, unlinked] of unlinkedByKey) {
		if (!groups.has(key)) {
			match.extra.push(...unlinked.map((t) => ({ taskId: t.id, reason: 'not_in_template' as const })));
		}
	}
	match.extra.sort((a, b) => tasks.findIndex((t) => t.id === a.taskId) - tasks.findIndex((t) => t.id === b.taskId));
	return match;
}

function conflictOf(
	key: MatchKey,
	templateTasks: TemplateTask[],
	candidates: EntityTask[],
	usage: Record<Id, TaskUsage>,
	defaultStatus: string
): MatchConflict {
	const { order, reason } = prePick(candidates, usage, defaultStatus);
	const pick: Record<Id, Id> = {};
	templateTasks.forEach((tt, i) => {
		if (i < order.length) pick[tt.id] = order[i].id;
	});
	return {
		key,
		templateTaskIds: templateTasks.map((tt) => tt.id),
		candidates: order.map((t) => t.id),
		prePick: pick,
		reason
	};
}
