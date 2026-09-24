/**
 * Undo: the record of what one entity's apply changed, the revert that puts it back, and the
 * downloadable file of a run's records. Pure, no I/O.
 *
 * The revert runs in probe 096's order (Kevin's Q-C), as one `_batch` (recipe 022, probe 104):
 *   1. `tasksToRevive`: `POST ?revive=1` per Task the apply deleted, not a batch request (103).
 *      Revive restores `template_task` (110). FIRST: a retired Task does not count as linked, so
 *      the old template's write would make a new Task for its template task, and the revive would
 *      then leave two on it (110). `buildRevert` refuses to build until they are revived.
 *   2. Read the edges live, then `buildRevert(rec, live, revived).batch` (requests see earlier
 *      ones, 098): old `template_task` on each claimed Task and each unlinked conflict loser, one
 *      Task per old template task (entity first makes the old template re-create them, 096), then
 *      the entity's old `task_template` (its re-sync overwrites its Tasks' fields and edges,
 *      096/102/109/111), then the second Task on an old template task (112, recipe 023), then delete the
 *      created Tasks (their edges retire, 089/104), then the apply's edges that write leaves (104,
 *      111, recipes 019 and 022), then the pre-merge fields, `content` included (112), then the omitted statuses.
 *   3. Read the edges live, then `buildEdgeRevert(rec, live)`: remove batch, revive each edge
 *      (095), then the create batch. Edges are matched to the before-snapshot by pair (ends, type,
 *      offset), not by id: the old template's write erases every edge whose downstream Task it
 *      holds and it lacks, and may re-create one of its own under a new id (111).
 * Dates are not restored: writing them pins (087), and revive/re-create reschedule from upstream
 * now (095). One exception: dates the apply filled on a Task that had none (102) are written back
 * null when no edge runs into the Task, before or after the apply: that write pins nothing (097). On
 * a dependent Task a null `start_date` pins it (093), so there they stay, noted. Assignees the apply
 * filled (102) are written back empty. `notes` carry what stays, the edges that come back under a
 * new id, and the pinned Tasks whose `dependency_violation` may differ (087, 092), to the result screen.
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
	const unlinked: NonNullable<UndoRecord['unlinked']> = [];
	const omitted: UndoRecord['omitted'] = [];
	const deletedTasks: Id[] = [];
	const deletedEdges: RowEdge[] = [];
	for (const r of batch) {
		if (r.request_type === 'update' && r.entity === 'Task') {
			const t = beforeTask.get(r.record_id);
			if (!t) continue;
			// A write of null unlinks a conflict loser (106); any other value is a claim.
			const links = r.data.template_task === null ? unlinked : claimed;
			if ('template_task' in r.data && !links.some((c) => c.taskId === t.id))
				links.push({ taskId: t.id, previousTemplateTask: t.templateTask?.id ?? null });
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

	// The undo's write of the old template re-syncs every Task linked to it (096: roto), revived
	// ones included (they come back before it). A link of unknown template counts as linked.
	const resyncedOnUndo = before.tasks
		.filter(
			(t) =>
				oldTemplate !== null &&
				(afterTask.has(t.id) || deleted.has(t.id)) &&
				t.templateTask !== null &&
				(t.templateTask.templateId === oldTemplate || t.templateTask.templateId === null)
		)
		.map((t) => t.id);
	const resyncedSet = new Set(resyncedOnUndo);

	const linkedBefore = before.tasks
		.filter((t) => t.templateTask !== null)
		.map((t) => ({ taskId: t.id, templateTask: t.templateTask!.id, templateId: t.templateTask!.templateId }));

	const hasUpstream = new Set([...before.edges, ...after.edges].map((e) => e.downstream));
	const datesRestored = new Set<Id>();
	const fieldValues: UndoRecord['fieldValues'] = [];
	for (const t of before.tasks) {
		const now = afterTask.get(t.id) ?? (deleted.has(t.id) ? t : undefined);
		if (!now) continue;
		const onTemplate = !deleted.has(t.id) && now.templateTask?.templateId === templateId;
		const resynced = resyncedSet.has(t.id);
		if (!onTemplate && !resynced) continue;
		const dated = t.startDate !== null && t.dueDate !== null;
		const was = policyValues(t);
		const is = policyValues(now);
		for (const field of Object.keys(was)) {
			const changed = !sameValue(was[field], is[field]);
			// 102: the re-sync writes `duration` only on a Task without dates.
			const atRisk = resynced && !(field === 'duration' && dated);
			if (changed || atRisk) fieldValues.push({ taskId: t.id, field, previous: was[field] });
		}
		// 102: the re-sync fills empty assignees; not under policy, so not in `fields`.
		if (t.assignees.length === 0 && (now.assignees.length > 0 || resynced))
			fieldValues.push({ taskId: t.id, field: 'task_assignees', previous: [] });
		// 102, 108: it fills the dates of a Task with neither. Written back null only where no edge
		// runs into it, before or after: a null start_date pins a dependent Task (093), not a root (097).
		if (
			!deleted.has(t.id) &&
			t.startDate === null &&
			t.dueDate === null &&
			(now.startDate !== null || now.dueDate !== null) &&
			!hasUpstream.has(t.id)
		) {
			fieldValues.push({ taskId: t.id, field: 'start_date', previous: null });
			fieldValues.push({ taskId: t.id, field: 'due_date', previous: null });
			datesRestored.add(t.id);
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
		if (!datesRestored.has(t.id) && (t.startDate !== now.startDate || t.dueDate !== now.dueDate))
			datesMoved.push({ taskId: t.id, before: dates(t), after: dates(now) });
	}

	// 087, 092: a pinned Task holds its dates and flags dependency_violation while an upstream edge
	// is broken. Where the apply changed its upstream edges or an upstream Task's dates, or its flag,
	// the undo's edge revert and dates it cannot restore may leave the flag other than before.
	const upstreamSpecs = (edges: Edge[], id: Id) =>
		edges
			.filter((e) => e.downstream === id)
			.map((e) => `${e.upstream}:${e.type}:${e.offsetDays}`)
			.sort()
			.join('|');
	const upstreamIds = (id: Id) =>
		new Set([...before.edges, ...after.edges].filter((e) => e.downstream === id).map((e) => e.upstream));
	const datesChanged = (id: Id) => {
		const b = beforeTask.get(id);
		const a = afterTask.get(id);
		if (!b || !a) return b !== a;
		return b.startDate !== a.startDate || b.dueDate !== a.dueDate;
	};
	const violationMayChange = before.tasks
		.filter((t) => {
			const now = afterTask.get(t.id) ?? t;
			if (!t.pinned && !now.pinned) return false;
			if (!hasUpstream.has(t.id)) return false;
			return (
				t.dependencyViolation !== now.dependencyViolation ||
				upstreamSpecs(before.edges, t.id) !== upstreamSpecs(after.edges, t.id) ||
				[...upstreamIds(t.id)].some(datesChanged)
			);
		})
		.map((t) => t.id)
		.sort((a, b) => a - b);

	return {
		version: 1,
		runId: input.runId,
		entity: ref(before.entity),
		templateId,
		appliedAt: input.appliedAt,
		previousTaskTemplate,
		claimed,
		unlinked,
		resyncedOnUndo,
		linkedBefore,
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
		datesMoved,
		violationMayChange
	};
}

// --- revert -------------------------------------------------------------------------------------

/** The Tasks to revive, one call each, before `buildRevert` (103, 110). */
export function tasksToRevive(rec: UndoRecord): Id[] {
	return [...rec.deletedTasks];
}

/**
 * `live`: the TaskDependency rows touching the entity's Tasks, read after the Task revives and
 * right before the batch. The batch deletes only rows it read (104: a gone one 404s the batch).
 * `revived`: the Tasks revived so far. Throws unless every `tasksToRevive` is among them (110).
 */
export function buildRevert(rec: UndoRecord, live: Edge[], revived: Id[]): RevertPlan {
	const done = new Set(revived);
	const pending = rec.deletedTasks.filter((id) => !done.has(id));
	if (pending.length > 0)
		throw new Error(
			`Revive Tasks ${pending.join(', ')} before the revert batch: the old template's write would re-create them (110)`
		);

	const batch: BatchRequest[] = [];
	const update = (entity: string, record_id: Id, data: Record<string, unknown>) =>
		batch.push({ request_type: 'update', entity, record_id, data });
	const relink = (c: { taskId: Id; previousTemplateTask: Id | null }) =>
		update('Task', c.taskId, {
			template_task: c.previousTemplateTask === null ? null : { type: 'Task', id: c.previousTemplateTask }
		});

	// 1. Tasks first (096): claims, then the conflict losers the apply unlinked (106). A second Task
	//    on one old template task waits until after the entity write (112).
	const { first, late, warnings } = orderRelinks(rec);
	first.forEach(relink);

	// 2. The entity's old template. Already this template: a rewrite would need a clear first (084)
	//    and would re-create the Tasks just unclaimed, so it is left as it is.
	const prev = rec.previousTaskTemplate;
	if (prev === null || prev.id !== rec.templateId)
		update(rec.entity.type, rec.entity.id, { task_template: prev === null ? null : wireValue(prev) });
	late.forEach(relink);

	// 3. What the apply made. A Task delete retires its edges (089, 104).
	for (const id of rec.created) batch.push({ request_type: 'delete', entity: 'Task', record_id: id });
	for (const id of batchEdgeDeletes(rec, live))
		batch.push({ request_type: 'delete', entity: 'TaskDependency', record_id: id });

	// 4. The fields both applies overwrote (096 step 4), then the statuses (kept by both, 102).
	const byTask = new Map<Id, Record<FieldName, unknown>>();
	for (const v of rec.fieldValues) {
		const data = byTask.get(v.taskId) ?? {};
		data[v.field] = fieldWire(v.field, v.previous);
		byTask.set(v.taskId, data);
	}
	for (const [id, data] of byTask) update('Task', id, data);
	for (const o of rec.omitted) update('Task', o.taskId, { sg_status_list: o.previousStatus });

	const notes: UndoNote[] = (rec.datesMoved ?? []).map((d) => ({ code: 'dates_moved', ...d }));
	notes.push(...warnings);
	if (rec.violationMayChange?.length) notes.push({ code: 'violation_may_change', taskIds: [...rec.violationMayChange] });
	notes.push({ code: 'history_kept' });

	return { batch, notes };
}

type Relink = { taskId: Id; previousTemplateTask: Id | null };

/**
 * Which old links go before the entity's `task_template` write and which after (112). The old
 * template's apply wires one Task per template task; with two linked, it picks, unstably, mostly
 * the one without edges. So only one Task per old template task is linked when it runs: the one
 * that held edges before the apply (then the lowest id); the others are relinked after it, where a
 * `template_task` write alone changes nothing (096). Recipe 023. A Task left linked through the apply, or
 * revived (110), is linked at the write already: a relink joins it after, unless only the relink
 * held edges. Several with edges, or that case: unmeasured (112), flagged, not guessed.
 */
function orderRelinks(rec: UndoRecord): { first: Relink[]; late: Relink[]; warnings: UndoNote[] } {
	const relinks = [...rec.claimed, ...(rec.unlinked ?? [])];
	const prev = rec.previousTaskTemplate;
	const oldTemplate = prev !== null && prev.id !== rec.templateId ? prev.id : null;
	if (oldTemplate === null) return { first: relinks, late: [], warnings: [] };

	const edged = new Set(
		(rec.edgesBefore ?? [...rec.droppedEdges, ...rec.deletedEdges]).flatMap((e) => [e.downstream, e.upstream])
	);
	const linkedBefore = rec.linkedBefore ?? [];
	const onOld = (target: Id) =>
		linkedBefore.every((l) => l.templateTask !== target || l.templateId === null || l.templateId === oldTemplate);
	const relinked = new Set(relinks.map((c) => c.taskId));
	const byTarget = new Map<Id, Relink[]>();
	for (const c of relinks) {
		if (c.previousTemplateTask === null || !onOld(c.previousTemplateTask)) continue;
		byTarget.set(c.previousTemplateTask, [...(byTarget.get(c.previousTemplateTask) ?? []), c]);
	}

	const deferred = new Set<Id>();
	const warnings: UndoNote[] = [];
	for (const [target, group] of byTarget) {
		const stayed = linkedBefore.filter((l) => l.templateTask === target && !relinked.has(l.taskId)).map((l) => l.taskId);
		if (group.length + stayed.length < 2) continue;
		const members = [...group.map((c) => c.taskId), ...stayed].sort((a, b) => a - b);
		const withEdges = members.filter((id) => edged.has(id));
		const relinkEdged = group.some((c) => edged.has(c.taskId));
		const stayedEdged = stayed.some((id) => edged.has(id));
		let unmeasured = withEdges.length > 1;
		if (stayed.length > 0) {
			if (relinkEdged && !stayedEdged) unmeasured = true;
			else group.forEach((c) => deferred.add(c.taskId));
		} else {
			const lead = [...group].sort((a, b) => Number(edged.has(b.taskId)) - Number(edged.has(a.taskId)) || a.taskId - b.taskId)[0];
			group.filter((c) => c !== lead).forEach((c) => deferred.add(c.taskId));
		}
		if (unmeasured) warnings.push({ code: 'linked_twice_unmeasured', templateTask: target, taskIds: members });
	}
	const late = relinks.filter((c) => deferred.has(c.taskId)).sort((a, b) => a.taskId - b.taskId);
	return { first: relinks.filter((c) => !deferred.has(c.taskId)), late, warnings };
}

/**
 * The apply's added edges the revert batch deletes (104). Left out:
 *   - edges on a created Task: they retire with it (089, 104);
 *   - under a write of a non-null old template, edges whose downstream Task goes back to it: that
 *     write erases every such edge the old template lacks, whatever the upstream end, and a DELETE
 *     of a gone row 404s and rolls back the batch (111). One it keeps is still live after the
 *     batch, and `buildEdgeRevert` removes it.
 * Edges with only the upstream end back on the old template survive the write: deleted here (111).
 * With no such write (old template null, or already this template), nothing removes them: all go
 * (104). Edges re-created under keep are not "added": they stand for the old rows (109).
 */
function batchEdgeDeletes(rec: UndoRecord, live: Edge[]): Id[] {
	const prev = rec.previousTaskTemplate;
	const resyncs = prev !== null && prev.id !== rec.templateId;
	// An older record without the list: leave every edge to the edge revert rather than risk a 404.
	if (resyncs && rec.resyncedOnUndo === undefined) return [];
	const resynced = new Set(rec.resyncedOnUndo ?? []);
	const created = new Set(rec.created);
	const liveIds = new Set(live.filter(hasId).map((e) => e.id));
	return rec.addedEdges
		.filter((e) => liveIds.has(e.id))
		.filter((e) => !created.has(e.downstream) && !created.has(e.upstream))
		.filter((e) => !resyncs || !resynced.has(e.downstream))
		.map((e) => e.id);
}

/**
 * The edge revert, from the TaskDependency rows touching the entity's Tasks read after
 * `buildRevert`'s batch and Task revives. Target: the edges before the apply, matched by pair
 * (downstream, upstream, type, offset), not by id: the old template's write erases edges it lacks
 * on the Tasks it holds downstream, and may re-create one of its own under a new id (111).
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
	const recreated: Id[] = [];
	const moved = new Set<Id>();

	for (const t of target) {
		if (liveIds.has(t.id)) continue;
		// 085: one row per pair, either direction. Free the pair first.
		const occupants = liveRows.filter((e) => !targetIds.has(e.id) && samePair(e, t));
		if (revivable.has(t.id)) {
			occupants.forEach((e) => removeIds.add(e.id));
			revive.push(t.id);
			moved.add(t.downstream);
			continue;
		}
		const copy = occupants.find((e) => sameSpec(e, t));
		occupants.filter((e) => e !== copy).forEach((e) => removeIds.add(e.id));
		recreated.push(t.id);
		if (copy) satisfied.add(copy.id);
		else {
			create.push(createEdge(t));
			moved.add(t.downstream);
		}
	}
	for (const e of liveRows) if (ours.has(e.id) && !satisfied.has(e.id)) removeIds.add(e.id);

	const remove: BatchRequest[] = liveRows
		.filter((e) => removeIds.has(e.id))
		.map((e) => ({ request_type: 'delete', entity: 'TaskDependency', record_id: e.id }));
	const left = liveRows.filter((e) => !targetIds.has(e.id) && !removeIds.has(e.id) && !satisfied.has(e.id));
	const notes: UndoNote[] = [];
	if (recreated.length > 0) notes.push({ code: 'edges_recreated', edgeIds: recreated });
	if (moved.size > 0) notes.push({ code: 'dates_may_move', taskIds: [...moved].sort((a, b) => a - b) });
	return { remove, revive, create, left, notes };
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

/** The policy fields of a Task, `content` always among them (112: the re-sync renames). */
function policyValues(t: EntityTask): Record<FieldName, unknown> {
	return 'content' in t.fields ? t.fields : { ...t.fields, content: t.content };
}

/** A field's wire value; `step` is read as its id (read.ts) and written as a Step link. */
function fieldWire(field: FieldName, v: unknown): unknown {
	if (field === 'step' && typeof v === 'number') return { type: 'Step', id: v };
	return wireValue(v);
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
