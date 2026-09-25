/**
 * The result screen's blocks: one per entity of a run, its Tasks grouped by Pipeline Step with
 * their outcome (kinds.ts), the run's totals in the plan's words, and one line for the entities
 * with nothing to write. Pure, no I/O.
 *
 * Task lines come from this tab's plan, created Task ids from the read-back (`createdFor`). A run
 * this tab did not plan (a stored run, an undo file) has only its undo record: counts, no names.
 */

import { KIND_LABEL } from './kinds';
import { entityKey } from './run';
import type { OutcomeLike, ResultRow } from './result-view';
import type { EntityPlan, Id, PlanKind, UndoRecord } from './types';

export type LineKind = Exclude<PlanKind, 'conflict'>;

export interface ResultTaskLine {
	/** Stable in its block: `t<task id>` or `c<template task id>`. */
	id: string;
	/** The Task on the entity; null for a create the read-back did not find. */
	taskId: Id | null;
	name: string;
	kind: LineKind;
	label: string;
	/** What else the apply did to it, in a few words. */
	note: string | null;
}

export interface StepGroup {
	step: string;
	lines: ResultTaskLine[];
}

export interface ResultBlock extends ResultRow {
	steps: StepGroup[];
	/** A stored run's landed entity: its undo record's counts ("2 created, 1 linked"). Else null. */
	tally: string | null;
	/** Its Tasks by outcome, for the card's one line (`runTotals` of this block alone). */
	counts: RunTotal[];
}

const NO_STEP = 'No Step';
const nameOf = (t: { content: string | null }) => (t.content ?? '').trim() || '(no name)';

/** One entity's Tasks after the apply, by Pipeline Step in plan order. */
export function entityTasks(plan: EntityPlan, createdFor: Array<{ templateTaskId: Id; taskId: Id }>, omitStatus: string): StepGroup[] {
	const created = new Map(createdFor.map((c) => [c.templateTaskId, c.taskId]));
	const groups = new Map<string, ResultTaskLine[]>();
	const add = (step: string | undefined, line: Omit<ResultTaskLine, 'label'>) => {
		const key = step?.trim() || NO_STEP;
		groups.set(key, [...(groups.get(key) ?? []), { ...line, label: KIND_LABEL[line.kind] }]);
	};
	for (const row of plan.rows) {
		if (row.kind === 'keep' || row.kind === 'claim') {
			const note = row.rename ? `Renamed from ${nameOf({ content: row.rename.from })}` : null;
			add(row.task.step?.name, {
				id: `t${row.task.id}`,
				taskId: row.task.id,
				name: nameOf(row.rename ? { content: row.rename.to } : row.task),
				kind: row.kind,
				note
			});
		} else if (row.kind === 'create') {
			const taskId = created.get(row.templateTask.id) ?? null;
			add(row.templateTask.step?.name, {
				id: `c${row.templateTask.id}`,
				taskId,
				name: nameOf(row.templateTask),
				kind: 'create',
				note: taskId === null ? 'Not created' : null
			});
		} else if (row.kind === 'extra') {
			const note = row.action === 'delete' ? 'Deleted' : row.action === 'omit' ? `Status set to ${omitStatus}` : null;
			add(row.task.step?.name, {
				id: `t${row.task.id}`,
				taskId: row.task.id,
				name: nameOf(row.task),
				kind: 'extra',
				note
			});
		}
	}
	return [...groups].map(([step, lines]) => ({ step, lines }));
}

/** What an undo record says was written, for a run this tab has no plan of. */
export function recordTally(rec: UndoRecord): string {
	const parts = [
		[rec.created.length, 'created'],
		[rec.claimed.length, 'linked'],
		[rec.omitted.length, 'omitted'],
		[rec.deletedTasks.length, 'deleted']
	] as const;
	return (
		parts
			.filter(([n]) => n > 0)
			.map(([n, word]) => `${n} ${word}`)
			.join(', ') || 'Nothing written'
	);
}

/** Block order: what needs a look, a retry in flight, the applied, then what did not change. */
const ORDER: ResultRow['kind'][][] = [['failed'], ['differences'], ['landing'], ['clean', 'landed'], ['undone'], ['not_applied']];

/**
 * The rows as blocks: failed first, then with differences, a retry in flight, the applied, the
 * undone, the never applied; run order within each.
 */
export function resultBlocks(rows: ResultRow[], plans: EntityPlan[], outcomes: OutcomeLike[], omitStatus: string): ResultBlock[] {
	const planOf = new Map(plans.map((p) => [entityKey(p.entity), p]));
	const outcomeOf = new Map(outcomes.map((o) => [entityKey(o.entity), o]));
	const rank = (r: ResultRow) => ORDER.findIndex((kinds) => kinds.includes(r.kind));
	return [...rows]
		.map((r, i) => ({ r, i }))
		.sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
		.map(({ r }) => {
			const plan = planOf.get(r.key);
			const result = outcomeOf.get(r.key)?.result;
			const applied = (r.kind === 'clean' || r.kind === 'differences') && plan && result?.kind === 'ok';
			const steps = applied ? entityTasks(plan, result.createdFor ?? [], omitStatus) : [];
			return {
				...r,
				steps,
				tally: r.kind === 'landed' && r.record ? recordTally(r.record) : null,
				counts: totalsOf(steps.flatMap((s) => s.lines))
			};
		});
}

export interface RunTotal {
	kind: LineKind;
	count: number;
	/** "3 created". */
	text: string;
}

const TOTAL_ORDER: LineKind[] = ['create', 'claim', 'keep', 'extra'];

/** The applied entities' Tasks by outcome, created counted only where the read-back found it. */
export function runTotals(blocks: ResultBlock[]): RunTotal[] {
	return totalsOf(blocks.flatMap((b) => b.steps.flatMap((s) => s.lines)));
}

function totalsOf(lines: ResultTaskLine[]): RunTotal[] {
	return TOTAL_ORDER.map((kind) => {
		const count = lines.filter((l) => l.kind === kind && (kind !== 'create' || l.taskId !== null)).length;
		return { kind, count, text: `${count} ${KIND_LABEL[kind].toLowerCase()}` };
	}).filter((t) => t.count > 0);
}

/** "12 Shots unchanged": the planned entities with nothing to write. Null when there are none. */
export function unchangedLine(plans: EntityPlan[], entityType: string | null): string | null {
	const n = plans.filter((p) => p.noop).length;
	if (n === 0) return null;
	const noun = entityType ? (n === 1 ? entityType : `${entityType}s`) : n === 1 ? 'entity' : 'entities';
	return `${n} ${noun} unchanged`;
}
