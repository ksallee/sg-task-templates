/**
 * Undo: the record of what one entity's apply changed, the revert that puts it back, and the
 * downloadable file of a run's records. Pure, no I/O.
 *
 * The revert runs in probe 096's order (recipe 0XX_undo_task_template_merge, Kevin's Q-C):
 *   1. `buildRevert(rec).batch`, one `_batch` (requests see earlier ones, 098):
 *      old `template_task` on each claimed Task FIRST (entity first makes the old template
 *      re-create them, 096), then the entity's old `task_template` (its re-sync overwrites its
 *      Tasks' fields, 096/102), then delete the created Tasks, then write the pre-merge fields
 *      back, then the omitted statuses.
 *   2. `reviveTasks`: `POST ?revive=1` per Task (048), not a batch request; brings back their
 *      edges too (089).
 *   3. Read the edges live, then `buildEdgeRevert(rec, live)`: remove batch, revive each edge
 *      (095), then the create batch for erased rows (101). Revive before any create on a pair:
 *      the other way is a 400 (095).
 * Dates are not restored: writing them pins (087), and revive/re-create reschedule from upstream
 * now (095). `notes` carry that to the result screen.
 */

import type {
	BatchRequest,
	Edge,
	EdgeRevert,
	EntityRef,
	EntitySnapshot,
	EntityTask,
	FieldName,
	Id,
	RevertPlan,
	TaskDates,
	UndoFile,
	UndoNote,
	UndoRecord
} from './types';

export const UNDO_FILE_VERSION = 1 as const;

type RowEdge = Edge & { id: Id };

export interface UndoInput {
	runId: string;
	templateId: Id;
	appliedAt: string;
	/** Read before the apply, frozen. */
	before: EntitySnapshot;
	/** Read back after the apply: the entity's Tasks and the edges touching them. */
	after: { tasks: EntityTask[]; edges: Edge[] };
	/** The apply `_batch` as sent (098): claims, omits, deletes, template write, write-backs. */
	batch: BatchRequest[];
	/** Created Tasks whose dates were cleared after read-back (097). */
	clearedDates?: UndoRecord['clearedDates'];
}

// --- record -------------------------------------------------------------------------------------

export function buildUndoRecord(input: UndoInput): UndoRecord {
	const { before, after, batch, templateId } = input;
	const beforeTask = new Map(before.tasks.map((t) => [t.id, t]));
	const afterTask = new Map(after.tasks.map((t) => [t.id, t]));
	const beforeEdges = before.edges.filter(hasId);
	const beforeEdgeIds = new Set(beforeEdges.map((e) => e.id));

	const claimed: UndoRecord['claimed'] = [];
	const omitted: UndoRecord['omitted'] = [];
	const deletedTasks: Id[] = [];
	const deletedEdges: RowEdge[] = [];
	for (const r of batch) {
		if (r.request_type === 'update' && r.entity === 'Task') {
			const t = beforeTask.get(r.record_id);
			if (!t) continue;
			if ('template_task' in r.data && !claimed.some((c) => c.taskId === t.id))
				claimed.push({ taskId: t.id, previousTemplateTask: t.templateTask?.id ?? null });
			if ('sg_status_list' in r.data && !omitted.some((o) => o.taskId === t.id))
				omitted.push({ taskId: t.id, previousStatus: t.status });
		} else if (r.request_type === 'delete' && r.entity === 'Task') {
			if (beforeTask.has(r.record_id)) deletedTasks.push(r.record_id);
		} else if (r.request_type === 'delete' && r.entity === 'TaskDependency') {
			const e = beforeEdges.find((x) => x.id === r.record_id);
			if (e) deletedEdges.push(e);
		}
	}

	const deleted = new Set(deletedTasks);
	const created = after.tasks.filter((t) => !beforeTask.has(t.id)).map((t) => t.id);
	const surviving = before.tasks.filter((t) => !deleted.has(t.id) && afterTask.has(t.id));

	const previousTaskTemplate = before.entity.taskTemplate;
	const oldTemplate = previousTaskTemplate && previousTaskTemplate.id !== templateId ? previousTaskTemplate.id : null;

	const fieldValues: UndoRecord['fieldValues'] = [];
	for (const t of surviving) {
		const now = afterTask.get(t.id)!;
		const onTemplate = now.templateTask?.templateId === templateId;
		// The undo's write of the old template re-syncs every Task linked to it (096: roto).
		const resynced =
			oldTemplate !== null &&
			t.templateTask !== null &&
			(t.templateTask.templateId === oldTemplate || t.templateTask.templateId === null);
		if (!onTemplate && !resynced) continue;
		const dated = t.startDate !== null && t.dueDate !== null;
		for (const field of Object.keys(t.fields)) {
			const changed = !sameValue(t.fields[field], now.fields[field]);
			// 102: the re-sync writes `duration` only on a Task without dates.
			const atRisk = resynced && !(field === 'duration' && dated);
			if (changed || atRisk) fieldValues.push({ taskId: t.id, field, previous: t.fields[field] });
		}
	}

	const retiredWithTask = (e: Edge) => deleted.has(e.downstream) || deleted.has(e.upstream);
	const deletedEdgeIds = new Set(deletedEdges.map((e) => e.id));
	const afterEdges = after.edges.filter(hasId);
	const afterEdgeIds = new Set(afterEdges.map((e) => e.id));
	const droppedEdges = beforeEdges.filter(
		(e) => !afterEdgeIds.has(e.id) && !deletedEdgeIds.has(e.id) && !retiredWithTask(e)
	);
	const fresh = afterEdges.filter((e) => !beforeEdgeIds.has(e.id));
	const recreatedEdges: UndoRecord['recreatedEdges'] = [];
	const used = new Set<Id>();
	for (const d of droppedEdges) {
		const copy = fresh.find((e) => !used.has(e.id) && sameSpec(e, d));
		if (copy) {
			used.add(copy.id);
			recreatedEdges.push({ previousId: d.id, id: copy.id });
		}
	}
	const addedEdges = fresh.filter((e) => !used.has(e.id));

	const datesMoved: NonNullable<UndoRecord['datesMoved']> = [];
	for (const t of surviving) {
		const now = afterTask.get(t.id)!;
		if (t.startDate !== now.startDate || t.dueDate !== now.dueDate)
			datesMoved.push({ taskId: t.id, before: dates(t), after: dates(now) });
	}

	return {
		version: 1,
		runId: input.runId,
		entity: ref(before.entity),
		templateId,
		appliedAt: input.appliedAt,
		previousTaskTemplate,
		claimed,
		created,
		fieldValues,
		omitted,
		deletedTasks,
		droppedEdges,
		recreatedEdges,
		deletedEdges,
		addedEdges,
		clearedDates: input.clearedDates ?? [],
		edgesBefore: beforeEdges,
		datesMoved
	};
}

// --- revert -------------------------------------------------------------------------------------

export function buildRevert(rec: UndoRecord): RevertPlan {
	const batch: BatchRequest[] = [];
	const update = (entity: string, record_id: Id, data: Record<string, unknown>) =>
		batch.push({ request_type: 'update', entity, record_id, data });

	// 1. Tasks first (096).
	for (const c of rec.claimed)
		update('Task', c.taskId, {
			template_task: c.previousTemplateTask === null ? null : { type: 'Task', id: c.previousTemplateTask }
		});

	// 2. The entity's old template. Already this template: a rewrite would need a clear first (084)
	//    and would re-create the Tasks just unclaimed, so it is left as it is.
	const prev = rec.previousTaskTemplate;
	if (prev === null || prev.id !== rec.templateId)
		update(rec.entity.type, rec.entity.id, { task_template: prev === null ? null : wireValue(prev) });

	// 3. What the apply made. A Task delete retires its edges (089).
	for (const id of rec.created) batch.push({ request_type: 'delete', entity: 'Task', record_id: id });

	// 4. The fields both applies overwrote (096 step 4), then the statuses (kept by both, 102).
	const byTask = new Map<Id, Record<FieldName, unknown>>();
	for (const v of rec.fieldValues) {
		const data = byTask.get(v.taskId) ?? {};
		data[v.field] = wireValue(v.previous);
		byTask.set(v.taskId, data);
	}
	for (const [id, data] of byTask) update('Task', id, data);
	for (const o of rec.omitted) update('Task', o.taskId, { sg_status_list: o.previousStatus });

	const notes: UndoNote[] = (rec.datesMoved ?? []).map((d) => ({ code: 'dates_moved', ...d }));
	if (rec.droppedEdges.length > 0) notes.push({ code: 'edges_recreated', edgeIds: rec.droppedEdges.map((e) => e.id) });
	notes.push({ code: 'history_kept' });

	return { batch, reviveTasks: [...rec.deletedTasks], notes };
}

/**
 * The edge revert, from the TaskDependency rows touching the entity's Tasks read after
 * `buildRevert`'s batch and Task revives. Target: the edges before the apply.
 */
export function buildEdgeRevert(rec: UndoRecord, live: Edge[]): EdgeRevert {
	const target = rec.edgesBefore ?? [...rec.droppedEdges, ...rec.deletedEdges];
	const liveRows = live.filter(hasId);
	const liveIds = new Set(liveRows.map((e) => e.id));
	const targetIds = new Set(target.map((e) => e.id));
	const revivable = new Set(rec.deletedEdges.map((e) => e.id));
	const ours = new Set([...rec.addedEdges.map((e) => e.id), ...rec.recreatedEdges.map((r) => r.id)]);

	const removeIds = new Set<Id>();
	const satisfied = new Set<Id>();
	const revive: Id[] = [];
	const create: BatchRequest[] = [];

	for (const t of target) {
		if (liveIds.has(t.id)) continue;
		// 085: one row per pair, either direction. Free the pair first.
		const occupants = liveRows.filter((e) => !targetIds.has(e.id) && samePair(e, t));
		if (revivable.has(t.id)) {
			occupants.forEach((e) => removeIds.add(e.id));
			revive.push(t.id);
			continue;
		}
		const copy = occupants.find((e) => sameSpec(e, t));
		occupants.filter((e) => e !== copy).forEach((e) => removeIds.add(e.id));
		if (copy) satisfied.add(copy.id);
		else create.push(createEdge(t));
	}
	for (const e of liveRows) if (ours.has(e.id) && !satisfied.has(e.id)) removeIds.add(e.id);

	const remove: BatchRequest[] = liveRows
		.filter((e) => removeIds.has(e.id))
		.map((e) => ({ request_type: 'delete', entity: 'TaskDependency', record_id: e.id }));
	const left = liveRows.filter((e) => !targetIds.has(e.id) && !removeIds.has(e.id) && !satisfied.has(e.id));
	return { remove, revive, create, left };
}

// --- file ---------------------------------------------------------------------------------------

export function serializeUndo(records: UndoRecord[]): string {
	const file: UndoFile = { version: UNDO_FILE_VERSION, records };
	return JSON.stringify(file, null, 2);
}

const RECORD_ARRAYS = [
	'claimed',
	'created',
	'fieldValues',
	'omitted',
	'deletedTasks',
	'droppedEdges',
	'recreatedEdges',
	'deletedEdges',
	'addedEdges',
	'clearedDates'
] as const;

/** Parse an undo file. Throws on anything that is not a version-1 file of version-1 records. */
export function parseUndoJson(text: string): UndoRecord[] {
	const file: unknown = JSON.parse(text);
	if (!isObject(file) || file.version !== UNDO_FILE_VERSION)
		throw new Error(`Unknown undo file version: ${isObject(file) ? String(file.version) : 'none'}`);
	if (!Array.isArray(file.records)) throw new Error('Not an undo file: no records');
	return file.records.map((r, i) => {
		if (!isObject(r) || r.version !== 1) throw new Error(`Unknown undo record version at ${i}`);
		const ok =
			typeof r.runId === 'string' &&
			typeof r.templateId === 'number' &&
			typeof r.appliedAt === 'string' &&
			isObject(r.entity) &&
			typeof r.entity.type === 'string' &&
			typeof r.entity.id === 'number' &&
			(r.previousTaskTemplate === null || isObject(r.previousTaskTemplate)) &&
			RECORD_ARRAYS.every((k) => Array.isArray(r[k]));
		if (!ok) throw new Error(`Not an undo record at ${i}`);
		return r as unknown as UndoRecord;
	});
}

// --- helpers ------------------------------------------------------------------------------------

function hasId(e: Edge): e is RowEdge {
	return e.id !== null;
}

function sameSpec(a: Edge, b: Edge): boolean {
	return a.downstream === b.downstream && a.upstream === b.upstream && a.type === b.type && a.offsetDays === b.offsetDays;
}

function samePair(a: Edge, b: Edge): boolean {
	return (
		(a.downstream === b.downstream && a.upstream === b.upstream) ||
		(a.downstream === b.upstream && a.upstream === b.downstream)
	);
}

/** 086 route 1; `offset_days` omitted when the old row had none (086 reads it back as None). */
function createEdge(e: Edge): BatchRequest {
	const data: Record<string, unknown> = {
		task: { type: 'Task', id: e.downstream },
		dependent_task: { type: 'Task', id: e.upstream },
		dependency_type: e.type
	};
	if (e.offsetDays !== null) data.offset_days = e.offsetDays;
	return { request_type: 'create', entity: 'TaskDependency', data };
}

function dates(t: EntityTask): TaskDates {
	return { start: t.startDate, due: t.dueDate };
}

function ref(e: EntityRef): EntityRef {
	return e.name === undefined ? { type: e.type, id: e.id } : { type: e.type, id: e.id, name: e.name };
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isRef(v: unknown): v is EntityRef {
	return isObject(v) && typeof v.type === 'string' && typeof v.id === 'number';
}

/** A link is written as type and id only: `name` is never sent (sg-widgets-core EntityRef). */
function wireValue(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(wireValue);
	if (isRef(v)) return { type: v.type, id: v.id };
	return v;
}

/** Links compare by type and id; everything else as JSON. */
function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(wireValue(a ?? null)) === JSON.stringify(wireValue(b ?? null));
}
