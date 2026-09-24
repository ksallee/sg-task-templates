/**
 * The apply screen: the last summary before the write (what the run writes, what blocks it, where
 * the undo record lives), the run header, and one live line per entity as the runner reports it.
 * Pure, no I/O.
 */

import { planTotals } from './entry';
import { entityKey } from './run';
import type { EntityPlan, EntityRef, EntityRunState, Id, PlanKind, Run, RunOptions } from './types';

/** An entity's name, else its type and id. */
export function entityLabel(e: EntityRef): string {
	return e.name ?? `${e.type} ${e.id}`;
}

/** The plans the run sends: a plan with nothing to write is left out (no read, no batch). */
export function writablePlans(plans: EntityPlan[]): EntityPlan[] {
	return plans.filter((p) => !p.noop);
}

export interface WriteSummary {
	entities: number;
	toWrite: number;
	nothingToWrite: number;
	/** The five plan counts (decisions). */
	totals: Record<PlanKind, number>;
	/** Entities whose `task_template` is written. */
	templateWrites: number;
	claims: number;
	creates: number;
	/** Field changes on kept and claimed Tasks, by policy. */
	overwrites: number;
	writeBacks: number;
	fillIfEmpty: number;
	renames: number;
	omits: number;
	/** Confirmed deletes only: unconfirmed ones are not sent (batch.ts). */
	deletes: number;
	deletesWithUsage: number;
	leaves: number;
	edgesAdded: number;
	/** Edges the apply erases and the batch re-creates under keep: same ends, new id (101, 109). */
	edgesRecreated: number;
	edgesRemoved: number;
	/** Created Tasks whose template dates are cleared after the apply (097). */
	datesCleared: number;
	/** Unpinned Tasks the new edges reschedule (092). */
	mayMove: number;
	/** Pinned Tasks that end up flagged `dependency_violation` (092). */
	wouldViolate: number;
}

/** What the run will write, summed over the plans with something to write. */
export function writeSummary(plans: EntityPlan[], opts: RunOptions): WriteSummary {
	const all = planTotals(plans);
	const writable = writablePlans(plans);
	const s: WriteSummary = {
		entities: plans.length,
		toWrite: writable.length,
		nothingToWrite: plans.length - writable.length,
		totals: { keep: all.keep, claim: all.claim, create: all.create, extra: all.extra, conflict: all.conflict },
		templateWrites: writable.length,
		claims: 0,
		creates: 0,
		overwrites: 0,
		writeBacks: 0,
		fillIfEmpty: 0,
		renames: 0,
		omits: 0,
		deletes: 0,
		deletesWithUsage: 0,
		leaves: 0,
		edgesAdded: 0,
		edgesRecreated: 0,
		edgesRemoved: 0,
		datesCleared: 0,
		mayMove: 0,
		wouldViolate: 0
	};
	for (const p of writable) {
		for (const r of p.rows) {
			if (r.kind === 'claim') s.claims++;
			if (r.kind === 'create') {
				s.creates++;
				if (opts.clearCreatedDates && r.datesClearable) s.datesCleared++;
			}
			if (r.kind === 'keep' || r.kind === 'claim') {
				if (r.rename) s.renames++;
				for (const c of r.fieldChanges) {
					if (c.policy === 'overwrite') s.overwrites++;
					else if (c.policy === 'keep') s.writeBacks++;
					else s.fillIfEmpty++;
				}
			}
			if (r.kind === 'extra') {
				if (r.action === 'omit') s.omits++;
				else if (r.action === 'delete' && opts.deleteConfirmed) {
					s.deletes++;
					if (r.usage.versions + r.usage.publishedFiles > 0) s.deletesWithUsage++;
				} else s.leaves += r.action === 'leave' ? 1 : 0;
			}
		}
		s.edgesAdded += p.edges.expectedAdded.length;
		for (const a of p.edges.affected) {
			if (a.action === 'keep') s.edgesRecreated++;
			else s.edgesRemoved++;
		}
		s.mayMove += p.edges.mayMove.length;
		s.wouldViolate += p.edges.wouldViolate.length;
	}
	return s;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export interface SummaryGroup {
	title: string;
	lines: string[];
}

/** What will be written, one sentence per non-zero item, grouped (entities, Tasks, fields, dependencies) in batch order. */
export function summaryGroups(s: WriteSummary): SummaryGroup[] {
	const groups: SummaryGroup[] = [];
	let lines: string[] = [];
	const group = (title: string, fill: () => void) => {
		lines = [];
		fill();
		if (lines.length) groups.push({ title, lines });
	};
	const add = (n: number, text: string) => n > 0 && lines.push(text);
	group('Entities', () => {
		add(s.templateWrites, `The template is set on ${plural(s.templateWrites, 'entity', 'entities')}.`);
		add(s.nothingToWrite, `${plural(s.nothingToWrite, 'entity already matches', 'entities already match')} the template: skipped.`);
	});
	group('Tasks', () => {
		add(s.claims, `${plural(s.claims, 'existing Task', 'existing Tasks')} matched by name and Step, linked to the template; ${s.claims === 1 ? 'its' : 'their'} status, assignees and publishes unchanged.`);
		add(s.creates, `${plural(s.creates, 'Task', 'Tasks')} created from the template.`);
		add(s.renames, `${plural(s.renames, 'Task', 'Tasks')} renamed to the template's name.`);
		add(s.omits, `${plural(s.omits, 'Task', 'Tasks')} not in the template set to the omit status.`);
		add(s.deletes, `${plural(s.deletes, 'Task', 'Tasks')} not in the template deleted${s.deletesWithUsage ? `, ${s.deletesWithUsage} with Versions or PublishedFiles` : ''}.`);
		add(s.leaves, `${plural(s.leaves, 'Task', 'Tasks')} not in the template, not changed.`);
	});
	group('Fields', () => {
		add(s.overwrites, `${plural(s.overwrites, 'field', 'fields')} overwritten with the template's value.`);
		add(s.writeBacks, `${plural(s.writeBacks, 'field', 'fields')} the template would overwrite, written back unchanged.`);
		add(s.fillIfEmpty, `${plural(s.fillIfEmpty, 'field', 'fields')} filled where empty.`);
		add(s.datesCleared, `${plural(s.datesCleared, 'created Task has', 'created Tasks have')} the template's dates cleared.`);
	});
	group('Dependencies and dates', () => {
		add(s.edgesAdded, `${plural(s.edgesAdded, 'dependency', 'dependencies')} added from the template.`);
		add(s.edgesRecreated, `${plural(s.edgesRecreated, 'dependency', 'dependencies')} removed by the apply, re-created (new ids).`);
		add(s.edgesRemoved, `${plural(s.edgesRemoved, 'dependency', 'dependencies')} removed.`);
		add(s.mayMove, `${plural(s.mayMove, 'unpinned Task', 'unpinned Tasks')} may be rescheduled by the new dependencies.`);
		add(s.wouldViolate, `${plural(s.wouldViolate, 'pinned Task', 'pinned Tasks')} will be flagged as violating a dependency.`);
	});
	return groups;
}

/** Why the run cannot start, in the order the plan screen fixes them; empty when it can. */
export function startBlockers(plans: EntityPlan[], opts: RunOptions): string[] {
	const writable = writablePlans(plans);
	if (writable.length === 0) return ['Nothing to write: every entity already matches the template.'];
	const out: string[] = [];
	const conflicted = writable.filter((p) => p.warnings.some((w) => w.code === 'unresolved_conflict')).length;
	if (conflicted) out.push(`${plural(conflicted, 'entity has', 'entities have')} a Task that needs a choice. Pick it on the plan.`);
	const extras = writable.flatMap((p) => p.rows.flatMap((r) => (r.kind === 'extra' ? [r] : [])));
	const deletes = extras.filter((r) => r.action === 'delete').length;
	if (deletes && !opts.deleteConfirmed)
		out.push(
			`${plural(deletes, 'Task is', 'Tasks are')} set to delete, not confirmed. Confirm on the plan, or set to leave.`
		);
	const omits = extras.filter((r) => r.action === 'omit').length;
	if (omits && !opts.omitStatus)
		out.push(`${plural(omits, 'Task is', 'Tasks are')} set to omit with no omit status. Pick one on the plan.`);
	return out;
}

/** Where the undo record lives. Not persistent: the screen warns before the start and offers the download. */
export function undoNote(persistent: boolean): { persistent: boolean; lines: string[] } {
	return {
		persistent,
		lines: [
			'Each entity is applied whole or not at all.',
			persistent
				? 'The undo record is stored in this browser as each entity is applied. Download it to undo from another browser.'
				: 'This browser cannot store the undo record. Download it before you close the tab, or undo is lost.'
		]
	};
}

export interface NewRunInput {
	id: string;
	project: EntityRef;
	template: { id: Id; code: string };
	user: EntityRef;
	options: RunOptions;
	plans: EntityPlan[];
	now: string;
}

/** The run header the store keeps, every writable entity pending. */
export function newRun(input: NewRunInput): Run {
	return {
		version: 1,
		id: input.id,
		project: input.project,
		template: input.template,
		user: input.user,
		options: input.options,
		startedAt: input.now,
		finishedAt: null,
		entities: writablePlans(input.plans).map((p) => ({ entity: ref(p.entity), status: { state: 'pending' } }))
	};
}

/**
 * A resumed run (brief 6): the stored run, the re-planned entities pending again with the new
 * options, the landed ones as they were.
 */
export function resumedRun(stored: Run, plans: EntityPlan[], opts: RunOptions): Run {
	const again = new Set(writablePlans(plans).map((p) => entityKey(p.entity)));
	const entities = stored.entities.map((e) =>
		again.has(entityKey(e.entity)) ? { entity: e.entity, status: { state: 'pending' } as EntityRunState } : e
	);
	for (const p of writablePlans(plans))
		if (!stored.entities.some((e) => entityKey(e.entity) === entityKey(p.entity)))
			entities.push({ entity: ref(p.entity), status: { state: 'pending' } });
	return { ...stored, options: opts, finishedAt: null, entities };
}

function ref(e: EntityRef): EntityRef {
	return e.name === undefined ? { type: e.type, id: e.id } : { type: e.type, id: e.id, name: e.name };
}

// --- live lines -----------------------------------------------------------------------------------

export type LineState = 'pending' | 'landing' | 'landed' | 'failed' | 'cancelled' | 'undone';

export interface EntityLine {
	key: string;
	entity: EntityRef;
	label: string;
	state: LineState;
	/** The client's error title, verbatim. */
	error: string | null;
}

const line = (entity: EntityRef, state: LineState, error: string | null = null): EntityLine => ({
	key: entityKey(entity),
	entity: ref(entity),
	label: entityLabel(entity),
	state,
	error
});

export function initialLines(plans: EntityPlan[]): EntityLine[] {
	return plans.map((p) => line(p.entity, 'pending'));
}

/** What the runner reports (apply.ts `ApplyProgress`). */
export interface RunnerEvent {
	entity: EntityRef;
	state: EntityRunState['state'];
	error?: { status: number | null; message: string };
}

const STATE_LINE: Record<EntityRunState['state'], LineState> = {
	pending: 'pending',
	applying: 'landing',
	done: 'landed',
	failed: 'failed',
	undone: 'undone'
};

export function applyEvent(lines: EntityLine[], ev: RunnerEvent): EntityLine[] {
	const key = entityKey(ev.entity);
	return lines.map((l) => (l.key === key ? { ...l, state: STATE_LINE[ev.state], error: ev.error?.message ?? null } : l));
}

/** After a cancel: what never started. */
export function cancelPending(lines: EntityLine[]): EntityLine[] {
	return lines.map((l) => (l.state === 'pending' ? { ...l, state: 'cancelled' } : l));
}

export function lineCounts(lines: EntityLine[]): Record<LineState, number> {
	const out: Record<LineState, number> = { pending: 0, landing: 0, landed: 0, failed: 0, cancelled: 0, undone: 0 };
	for (const l of lines) out[l.state]++;
	return out;
}

/** A stored run's entities as lines. `applying` in the store = landing, maybe landed (resume). */
export function linesFromRun(run: Run): EntityLine[] {
	return run.entities.map(({ entity, status }) => line(entity, STATE_LINE[status.state], status.state === 'failed' ? status.error.message : null));
}
