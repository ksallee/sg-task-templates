/**
 * The apply screen: the run header and one live line per entity as the runner reports it. What
 * Apply's confirm dialog shows is in apply-confirm.ts. Pure, no I/O.
 */

import { entityKey } from './run';
import type { EntityPlan, EntityRef, EntityRunState, Id, Run, RunOptions } from './types';

/** An entity's name, else its type and id. */
export function entityLabel(e: EntityRef): string {
	return e.name ?? `${e.type} ${e.id}`;
}

/** The plans the run sends: a plan with nothing to write is left out (no read, no batch). */
export function writablePlans(plans: EntityPlan[]): EntityPlan[] {
	return plans.filter((p) => !p.noop);
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
