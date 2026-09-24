/**
 * The result screen: one row per entity of a run (landed clean, landed with differences, failed,
 * undone, never applied), each difference and undo note as a sentence, and the notes an undo
 * carries before it runs. Pure, no I/O.
 */

import { entityLabel } from './apply-view';
import { entityKey } from './run';
import { buildRevert, tasksToRevive } from './undo';
import type { EntityPlan, EntityRef, EntityResult, Id, ResultDifference, Run, TaskDates, UndoNote, UndoRecord } from './types';

// --- names --------------------------------------------------------------------------------------

export interface NameBook {
	task(id: Id): string;
	templateTask(id: Id): string;
}

/** Task and template task names from the plans of this session; `Task <id>` for anything else. */
export function nameBook(plans: EntityPlan[]): NameBook {
	const tasks = new Map<Id, string>();
	const templateTasks = new Map<Id, string>();
	const add = (m: Map<Id, string>, id: Id, content: string | null) => {
		if (content !== null && !m.has(id)) m.set(id, content);
	};
	for (const p of plans)
		for (const r of p.rows) {
			if (r.kind === 'conflict') {
				r.candidates.forEach((c) => add(tasks, c.task.id, c.task.content));
				r.templateTasks.forEach((t) => add(templateTasks, t.id, t.content));
				continue;
			}
			if (r.kind !== 'create') add(tasks, r.task.id, r.task.content);
			if (r.kind !== 'extra') add(templateTasks, r.templateTask.id, r.templateTask.content);
		}
	return {
		task: (id) => tasks.get(id) ?? `Task ${id}`,
		templateTask: (id) => templateTasks.get(id) ?? `template task ${id}`
	};
}

const show = (v: unknown) => (v === undefined || v === null ? 'null' : JSON.stringify(v));

export function describeDifference(d: ResultDifference, n: NameBook): string {
	switch (d.code) {
		case 'create_missing':
			return `${n.templateTask(d.templateTaskId)} was not created.`;
		case 'create_unexpected':
			return `${n.task(d.taskId)} was created for ${n.templateTask(d.templateTaskId)}, which the plan did not create.`;
		case 'claim_missing':
			return `${n.task(d.taskId)} is not linked to ${n.templateTask(d.templateTaskId)}.`;
		case 'writeback_missing':
			return `${n.task(d.taskId)}: ${d.field} is ${show(d.actual)}, expected ${show(d.expected)}.`;
		case 'delete_missing':
			return `${n.task(d.taskId)} was not deleted.`;
		case 'unlink_missing':
			return `${n.task(d.taskId)} is still linked to ${n.templateTask(d.templateTaskId)}.`;
		case 'edge_expected_missing':
			return `The dependency ${n.task(d.downstream)} on ${n.task(d.upstream)} was not added.`;
		case 'edge_recreate_missing':
			return `The kept dependency ${n.task(d.downstream)} on ${n.task(d.upstream)} was not re-created.`;
		case 'edge_still_present':
			return `Dependency ${d.edgeId} is still there.`;
	}
}

const span = (d: TaskDates) => `${d.start ?? 'none'} to ${d.due ?? 'none'}`;

const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function describeNote(note: UndoNote, n: NameBook): string {
	switch (note.code) {
		case 'dates_moved':
			if (note.before.start === null && note.before.due === null)
				return `${n.task(note.taskId)}: the apply filled its dates from the template (now ${span(note.after)}). Undo does not clear them: a null start date pins a Task with an upstream dependency.`;
			return `${n.task(note.taskId)}: the apply moved its dates (${span(note.before)}, now ${span(note.after)}). Undo does not write them back: that would pin it.`;
		case 'edges_recreated':
			return `${note.edgeIds.length} ${note.edgeIds.length === 1 ? 'dependency comes' : 'dependencies come'} back as new rows: same ends, type and offset, new ids.`;
		case 'dates_may_move':
			return `Dates may move on ${list(note.taskIds.map(n.task))}: unpinned Tasks downstream of a revived or re-created dependency reschedule.`;
		case 'linked_twice_unmeasured':
			return `${list(note.taskIds.map(n.task))} were both linked to ${n.templateTask(note.templateTask)}: which one the old template wires is the server's pick, not measured.`;
		case 'violation_may_change':
			return `The dependency violation flag may differ from before on ${list(note.taskIds.map(n.task))}: pinned Tasks keep their dates while what they depend on changed.`;
		case 'history_kept':
			return 'The event log keeps the apply and the undo.';
	}
}

/**
 * The notes an undo will carry, before it runs: what `buildRevert` says from the record alone
 * (moved dates, twice-linked Tasks, history), plus what the edge revert will do with the edges the
 * apply erased (new ids, 101/109/111) and deleted (revived, 095). The run's own notes may add to it.
 */
export function undoPreviewNotes(records: UndoRecord[]): UndoNote[] {
	return mergeNotes(
		records.map((rec) => {
			const notes: UndoNote[] = buildRevert(rec, [], tasksToRevive(rec)).notes.filter((x) => x.code !== 'history_kept');
			const recreated = new Set(rec.recreatedEdges.map((r) => r.previousId));
			if (rec.droppedEdges.length) notes.push({ code: 'edges_recreated', edgeIds: rec.droppedEdges.map((e) => e.id) });
			const moved = [...rec.droppedEdges.filter((e) => !recreated.has(e.id)), ...rec.deletedEdges].map((e) => e.downstream);
			if (moved.length) notes.push({ code: 'dates_may_move', taskIds: [...new Set(moved)].sort((a, b) => a - b) });
			notes.push({ code: 'history_kept' });
			return notes;
		})
	);
}

/** Several entities' notes as one list: edge ids and Task ids joined, one history note, last. */
export function mergeNotes(groups: UndoNote[][]): UndoNote[] {
	const out: UndoNote[] = [];
	let recreated: Extract<UndoNote, { code: 'edges_recreated' }> | null = null;
	let mayMove: Extract<UndoNote, { code: 'dates_may_move' }> | null = null;
	let violation: Extract<UndoNote, { code: 'violation_may_change' }> | null = null;
	let history = false;
	for (const note of groups.flat()) {
		if (note.code === 'history_kept') history = true;
		else if (note.code === 'edges_recreated') {
			if (recreated) recreated.edgeIds = [...recreated.edgeIds, ...note.edgeIds];
			else out.push((recreated = { ...note, edgeIds: [...note.edgeIds] }));
		} else if (note.code === 'dates_may_move') {
			if (mayMove) mayMove.taskIds = [...new Set([...mayMove.taskIds, ...note.taskIds])].sort((a, b) => a - b);
			else out.push((mayMove = { ...note, taskIds: [...note.taskIds] }));
		} else if (note.code === 'violation_may_change') {
			if (violation) violation.taskIds = [...new Set([...violation.taskIds, ...note.taskIds])].sort((a, b) => a - b);
			else out.push((violation = { ...note, taskIds: [...note.taskIds] }));
		} else out.push(note);
	}
	if (history) out.push({ code: 'history_kept' });
	return out;
}

// --- rows ---------------------------------------------------------------------------------------

export type ResultKind = 'clean' | 'differences' | 'landed' | 'landing' | 'failed' | 'undone' | 'not_applied';

export interface ResultRow {
	key: string;
	entity: EntityRef;
	label: string;
	/** `landed`: landed in another session or before a reload; no read-back to compare here. */
	kind: ResultKind;
	differences: string[];
	error: string | null;
	record: UndoRecord | null;
	canUndo: boolean;
	canRetry: boolean;
}

/** An apply outcome as the screen needs it (apply.ts `EntityOutcome`). */
export interface OutcomeLike {
	entity: EntityRef;
	result: EntityResult;
}

/**
 * One row per entity of the run, in run order. `outcomes` are this session's (a stored run has
 * none); `retryable` holds the keys whose plan this session still has.
 */
export function resultRows(run: Run, outcomes: OutcomeLike[], names: NameBook, retryable: ReadonlySet<string>): ResultRow[] {
	const byKey = new Map(outcomes.map((o) => [entityKey(o.entity), o]));
	return run.entities.map(({ entity, status }) => {
		const key = entityKey(entity);
		const outcome = byKey.get(key);
		const record = status.state === 'done' || status.state === 'failed' || status.state === 'undone' ? status.undo : null;
		const row: ResultRow = {
			key,
			entity,
			label: entityLabel(entity),
			kind: 'not_applied',
			differences: [],
			error: null,
			record,
			canUndo: (status.state === 'done' || status.state === 'failed') && record !== null,
			canRetry: false
		};
		if (status.state === 'done') {
			const diff = outcome?.result.kind === 'ok' ? outcome.result.differences : null;
			row.kind = diff === null ? 'landed' : diff.length ? 'differences' : 'clean';
			row.differences = (diff ?? []).map((d) => describeDifference(d, names));
		} else if (status.state === 'failed') {
			row.kind = 'failed';
			row.error = status.error.message;
			row.canRetry = retryable.has(key);
		} else if (status.state === 'undone') row.kind = 'undone';
		else if (status.state === 'applying') row.kind = 'landing';
		return row;
	});
}

export interface ResultGroup {
	kind: ResultKind;
	title: string;
	rows: ResultRow[];
}

/** Outcome groups in the order the screen shows them: what needs a look first. */
export const RESULT_GROUPS: ReadonlyArray<{ kind: ResultKind; title: string }> = [
	{ kind: 'failed', title: 'Failed' },
	{ kind: 'differences', title: 'Landed with differences' },
	{ kind: 'landing', title: 'Landing' },
	{ kind: 'clean', title: 'Landed clean' },
	{ kind: 'landed', title: 'Landed earlier' },
	{ kind: 'undone', title: 'Undone' },
	{ kind: 'not_applied', title: 'Not applied' }
];

/** The rows by outcome, run order kept inside a group, empty groups left out. */
export function groupRows(rows: ResultRow[]): ResultGroup[] {
	return RESULT_GROUPS.map((g) => ({ ...g, rows: rows.filter((r) => r.kind === g.kind) })).filter((g) => g.rows.length > 0);
}

/** `undo-<template>-<started at>.json`, safe on every file system. */
export function undoFileName(run: Pick<Run, 'template' | 'startedAt'>): string {
	const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '-');
	return `undo-${safe(run.template.code)}-${safe(run.startedAt)}.json`;
}
