/**
 * Batch builder: one entity's plan to the requests that apply it. Pure, no I/O.
 *
 * Phase 1 is ONE `_batch` per entity (098: requests run in order, each sees the ones before it;
 * one failure rolls back the whole entity, recipe 002):
 *   1. unlinks: `template_task: null` on conflict losers still linked to the conflict's template
 *      tasks: at most one Task per template task before the apply, or the server picks (106);
 *   2. claims: `template_task` on each claimed Task, conflict picks included;
 *   3. `task_template: null` when it already holds the template (084), then `task_template: T`;
 *   4. write-backs of kept field values, which the apply just overwrote (102);
 *   5. re-creates of kept edges the apply erased (102, 109), as TaskDependency rows (086, 095);
 *   6. extras: omit (status, which the apply keeps, 102) or delete (confirmed only).
 *
 * Phase 2 needs ids the server makes during the apply, which a batch cannot reference (002, 086):
 * date clearing on created Tasks (097) and replaced-edge keeps (the template's copy has a new id,
 * 102; `EdgePlan.transientAdded`). `buildAfterApply` builds it from the post-apply read-back.
 *
 * An edge flagged `closesLoop` is never re-created, keep or not: the server refuses a loop (085,
 * 107: 400, and the whole batch rolls back).
 *
 * Size: the corpus measured no batch cap (002: 5001 requests validated in full); it advises staying
 * near 200 requests for the response window only. No chunking here: splitting one entity's batch
 * would give up its atomicity.
 */

import type {
	AffectedEdge,
	BatchRequest,
	Edge,
	EdgeSpec,
	EntityPlan,
	EntityTask,
	EntityWrite,
	Id,
	ProjectContext,
	RunOptions
} from './types';

const taskRef = (id: Id) => ({ type: 'Task', id });

const update = (entity: string, record_id: Id, data: Record<string, unknown>): BatchRequest => ({
	request_type: 'update',
	entity,
	record_id,
	data
});

/**
 * `template_task: null` on each conflict loser linked to one of its conflict's template tasks (106).
 * Goes before the template write. A loser linked elsewhere is left alone.
 */
export function unlinkRequests(plan: EntityPlan): BatchRequest[] {
	const out: BatchRequest[] = [];
	for (const row of plan.rows) {
		if (row.kind !== 'extra' || row.reason !== 'conflict_loser' || !row.task.templateTask) continue;
		const conflict = plan.rows.find(
			(r) => r.kind === 'conflict' && r.candidates.some((c) => c.task.id === row.task.id)
		);
		if (conflict?.kind !== 'conflict') continue;
		const linkId = row.task.templateTask.id;
		if (conflict.templateTasks.some((tt) => tt.id === linkId)) {
			out.push(update('Task', row.task.id, { template_task: null }));
		}
	}
	return out;
}

/** `template_task` on each claimed Task, and on each conflict pick not already linked. */
export function claimRequests(plan: EntityPlan): BatchRequest[] {
	const claims = new Map<Id, Id>(); // Task id -> template task id
	for (const row of plan.rows) {
		if (row.kind === 'claim') claims.set(row.task.id, row.templateTask.id);
		if (row.kind !== 'conflict') continue;
		for (const [ttId, taskId] of Object.entries(row.pick)) {
			if (taskId === null) continue; // the apply creates it
			const cand = row.candidates.find((c) => c.task.id === taskId);
			if (cand?.task.templateTask?.id === Number(ttId)) continue; // already linked: a keep
			if (!claims.has(taskId)) claims.set(taskId, Number(ttId));
		}
	}
	return [...claims].map(([taskId, ttId]) => update('Task', taskId, { template_task: taskRef(ttId) }));
}

/** `task_template: null` first only when it already equals the template (084), then T. */
export function templateRequests(plan: EntityPlan): BatchRequest[] {
	const { type, id } = plan.entity;
	const set = update(type, id, { task_template: { type: 'TaskTemplate', id: plan.templateId } });
	return plan.needsClearFirst ? [update(type, id, { task_template: null }), set] : [set];
}

/** A link as `{type, id}`, a multi-entity as a bare list of those (field_types/multi_entity). */
function wireValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(wireValue);
	if (value && typeof value === 'object' && 'type' in value && 'id' in value) {
		const ref = value as { type: unknown; id: unknown };
		return { type: ref.type, id: ref.id };
	}
	return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(wireValue(a)) === JSON.stringify(wireValue(b));

/**
 * The value each kept or claimed Task must hold after the apply, where the apply writes another
 * (102 overwrites with the template's non-empty value). One request per Task.
 */
export function writeBackRequests(plan: EntityPlan): BatchRequest[] {
	const out: BatchRequest[] = [];
	for (const row of plan.rows) {
		if (row.kind !== 'keep' && row.kind !== 'claim') continue;
		const data: Record<string, unknown> = {};
		for (const c of row.fieldChanges) {
			if (!same(c.result, c.template)) data[c.field] = wireValue(c.result);
		}
		if (Object.keys(data).length) out.push(update('Task', row.task.id, data));
	}
	return out;
}

function createEdge(e: EdgeSpec): BatchRequest {
	return {
		request_type: 'create',
		entity: 'TaskDependency',
		data: {
			task: taskRef(e.downstream),
			dependent_task: taskRef(e.upstream),
			dependency_type: e.type,
			offset_days: e.offsetDays
		}
	};
}

/** Set by edges.ts on an edge whose re-create would close a loop (085, 107). Defensive: never re-created. */
const closesLoop = (a: AffectedEdge) => a.closesLoop === true;

const kept = (plan: EntityPlan, cause: AffectedEdge['cause']) =>
	plan.edges.affected.filter((a) => a.cause === cause && a.action === 'keep' && !closesLoop(a));

/** Extras this batch deletes: their edges go with them (089, 103). */
function deletedExtras(plan: EntityPlan, opts?: Pick<RunOptions, 'deleteConfirmed'>): Set<Id> {
	if (!opts?.deleteConfirmed) return new Set();
	return new Set(plan.rows.flatMap((r) => (r.kind === 'extra' && r.action === 'delete' ? [r.task.id] : [])));
}

/**
 * Kept edges the apply erases with no template copy on the pair: re-created after the template
 * write, new id. `not_in_template`: between linked Tasks (102). `outside_upstream`: a linked Task
 * on a Task not linked to T (109). An edge with an end this batch deletes is never re-created:
 * it would point at a retired Task and roll back the batch; it counts as removed (103). `remove` sends
 * nothing: the apply erases them. Replaced edges: `buildAfterApply`.
 */
export function edgeKeepRequests(plan: EntityPlan, opts?: Pick<RunOptions, 'deleteConfirmed'>): BatchRequest[] {
	const gone = deletedExtras(plan, opts);
	return [...kept(plan, 'not_in_template'), ...kept(plan, 'outside_upstream')]
		.filter((a) => !gone.has(a.existing.downstream) && !gone.has(a.existing.upstream))
		.map((a) => createEdge(a.existing));
}

/** Omit writes `omitStatus`; delete only once confirmed (brief 3). Throws on an invalid status. */
export function extraRequests(plan: EntityPlan, opts: RunOptions, ctx: ProjectContext): BatchRequest[] {
	const out: BatchRequest[] = [];
	for (const row of plan.rows) {
		if (row.kind !== 'extra') continue;
		if (row.action === 'omit') {
			if (!ctx.validTaskStatuses.includes(opts.omitStatus)) {
				throw new Error(`"${opts.omitStatus}" is not a Task status in this project. Pick the status omitted Tasks take.`);
			}
			if (row.task.status !== opts.omitStatus) {
				out.push(update('Task', row.task.id, { sg_status_list: opts.omitStatus }));
			}
		}
		if (row.action === 'delete' && opts.deleteConfirmed) {
			// A delete inside _batch retires the Task like DELETE: revivable, same id, fields, edges
			// and Version.sg_task (103). Its TaskDependency rows are retired with it (089).
			out.push({ request_type: 'delete', entity: 'Task', record_id: row.task.id });
		}
	}
	return out;
}

/** Phase 1: the entity's one `_batch`, and the template tasks whose created Task gets cleared. */
export function buildEntityWrite(plan: EntityPlan, opts: RunOptions, ctx: ProjectContext): EntityWrite {
	const { type, id, name } = plan.entity;
	const entity = name === undefined ? { type, id } : { type, id, name };
	const clearDatesFor = opts.clearCreatedDates
		? plan.rows.flatMap((r) => (r.kind === 'create' && r.datesClearable ? [r.templateTask.id] : []))
		: [];
	if (plan.noop) return { entity, batch: [], clearDatesFor };
	const batch = [
		...unlinkRequests(plan),
		...claimRequests(plan),
		...templateRequests(plan),
		...writeBackRequests(plan),
		...edgeKeepRequests(plan, opts),
		...extraRequests(plan, opts, ctx)
	];
	return { entity, batch, clearDatesFor };
}

/** What the I/O layer reads back after phase 1: the entity's Tasks and their TaskDependency rows. */
export interface AfterApply {
	tasks: EntityTask[];
	edges: Edge[];
}

const samePair = (a: EdgeSpec, b: EdgeSpec) =>
	(a.downstream === b.downstream && a.upstream === b.upstream) ||
	(a.downstream === b.upstream && a.upstream === b.downstream);

/**
 * Phase 2, from the read-back: date clearing on created Tasks (opt-in, 097), then each
 * `transientAdded` copy: delete the template's copy, found by pair, and re-create the kept edge
 * (085 allows one row per pair). Empty when there is nothing to do.
 */
export function buildAfterApply(plan: EntityPlan, opts: RunOptions, after: AfterApply): BatchRequest[] {
	const out: BatchRequest[] = [];
	if (opts.clearCreatedDates) {
		const existing = new Set<Id>();
		for (const r of plan.rows) {
			if (r.kind === 'keep' || r.kind === 'claim' || r.kind === 'extra') existing.add(r.task.id);
			if (r.kind === 'conflict') r.candidates.forEach((c) => existing.add(c.task.id));
		}
		const clearable = new Set(
			plan.rows.flatMap((r) => (r.kind === 'create' && r.datesClearable ? [r.templateTask.id] : []))
		);
		for (const t of after.tasks) {
			if (existing.has(t.id) || !t.templateTask || !clearable.has(t.templateTask.id)) continue;
			if (after.edges.some((e) => e.downstream === t.id)) continue; // 093: a null write would pin it
			if (t.startDate === null && t.dueDate === null) continue;
			out.push(update('Task', t.id, { start_date: null, due_date: null }));
		}
	}
	for (const t of plan.edges.transientAdded ?? []) {
		const a = plan.edges.affected.find((x) => x.existing.id === t.keptEdge);
		if (!a || a.action !== 'keep' || closesLoop(a)) continue;
		const live = after.edges.find((e) => samePair(e, a.existing));
		if (live?.id === a.existing.id) continue; // the apply left it
		if (live?.id != null) out.push({ request_type: 'delete', entity: 'TaskDependency', record_id: live.id });
		out.push(createEdge(a.existing));
	}
	return out;
}

/**
 * Checks a batch skips on the server (002: a batch create skips validation): a record id on every
 * update and delete, data on every update, schema names, no Task create (the apply creates Tasks),
 * one dependency per pair (085). With the plan: no delete of an edge the template write erases,
 * which 404s and rolls back the whole batch (104).
 */
export function validateRequests(reqs: BatchRequest[], plan?: EntityPlan): string[] {
	const errors: string[] = [];
	const pairs = new Set<string>();
	const erased = new Set<Id>((plan?.edges.affected ?? []).map((a) => a.existing.id));
	reqs.forEach((r, i) => {
		const at = `request ${i}`;
		if (!/^[A-Z][A-Za-z0-9]*$/.test(r.entity)) errors.push(`${at}: entity "${r.entity}" is not a schema name`);
		if (r.request_type !== 'create') {
			const rid = (r as { record_id?: unknown }).record_id;
			if (!Number.isInteger(rid) || (rid as number) <= 0) errors.push(`${at}: ${r.request_type} without a record_id`);
		}
		if (r.request_type === 'update' && Object.keys(r.data ?? {}).length === 0) errors.push(`${at}: update without data`);
		if (r.request_type === 'delete' && r.entity === 'TaskDependency' && erased.has(r.record_id)) {
			errors.push(`${at}: deletes TaskDependency ${r.record_id}, which the template write erases (404, 104)`);
		}
		if (r.request_type === 'create' && r.entity === 'Task') errors.push(`${at}: creates a Task; the apply creates Tasks`);
		if (r.request_type === 'create' && r.entity === 'TaskDependency') {
			const d = (r.data.task as { id: Id }).id;
			const u = (r.data.dependent_task as { id: Id }).id;
			const key = [Math.min(d, u), Math.max(d, u)].join('-');
			if (pairs.has(key)) errors.push(`${at}: a second dependency between Task ${Math.min(d, u)} and Task ${Math.max(d, u)}`);
			pairs.add(key);
		}
	});
	return errors;
}
