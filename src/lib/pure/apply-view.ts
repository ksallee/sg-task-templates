/**
 * The apply screen: the run header and one live line per entity as the runner reports it. What
 * Apply's confirm dialog shows is in apply-confirm.ts. Pure, no I/O.
 */

import { entityKey } from './run';
import type { EntityPlan, EntityRef, EntityRunState, FailedStage, Id, Run, RunOptions } from './types';
import type { SnapshotChange } from './drift';

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
export interface RunnerEvent extends Partial<Failure> {
	entity: EntityRef;
	state: EntityRunState['state'];
}

/** A failure as the runner reports it and the store keeps it. */
export interface Failure {
	error: { status: number | null; message: string };
	stage?: FailedStage;
	written?: SnapshotChange[] | null;
	drift?: SnapshotChange[];
}

/**
 * A failure in plain words, and the server's text as the detail where there is one. `noun`: the
 * entity type ("Shot"). A run stored before stages were kept shows its message as it is.
 */
export function failureText(f: Failure, noun: string): { text: string; detail: string | null } {
	const raw = f.error.message;
	const nothing = f.written === undefined || (Array.isArray(f.written) && f.written.length === 0);
	switch (f.stage) {
		case undefined:
		case 'validate':
			return { text: raw, detail: null };
		case 'changed':
			return { text: `The ${noun} changed on Flow PT since the plan. Nothing was written.`, detail: null };
		case 'read':
			return { text: `Reading the ${noun} before the write failed. Nothing was written.`, detail: raw };
		case 'apply':
			return {
				text: f.written === null ? `Flow PT refused the write. Reading the ${noun} after it failed.` : `Flow PT refused the write.${nothing ? ' Nothing was written.' : ''}`,
				detail: raw
			};
		case 'read_back':
			return { text: `Applied, then reading the ${noun} back failed.`, detail: raw };
		case 'after_apply':
			return { text: 'Applied, then Flow PT refused the date and dependency fixes.', detail: raw };
		case 'interrupted':
			return { text: `The tab closed while this ${noun} was applying.${nothing ? ' Nothing was written.' : ''}`, detail: null };
	}
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
	const error = ev.error ? failureText({ ...ev, error: ev.error }, ev.entity.type).text : null;
	return lines.map((l) => (l.key === key ? { ...l, state: STATE_LINE[ev.state], error } : l));
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
	return run.entities.map(({ entity, status }) =>
		line(entity, STATE_LINE[status.state], status.state === 'failed' ? failureText(status, entity.type).text : null)
	);
}

// --- the run in words ------------------------------------------------------------------------------

const STATE_WORD: Record<LineState, string> = {
	landed: 'applied',
	landing: 'applying',
	failed: 'failed',
	undone: 'undone',
	cancelled: 'cancelled',
	pending: 'not started'
};

const WORD_ORDER: LineState[] = ['landed', 'landing', 'failed', 'undone', 'cancelled', 'pending'];

/** "2 applied, 1 failed": the non-zero counts only. `words` renames a state. */
export function countsLine(counts: Record<LineState, number>, words: Partial<Record<LineState, string>> = {}): string {
	const parts = WORD_ORDER.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${words[s] ?? STATE_WORD[s]}`);
	return parts.join(', ') || 'nothing applied';
}

/** The apply screen's title: a failure or a cancel shows in it. */
export function applyTitle(phase: 'running' | 'done', counts: Record<LineState, number>): string {
	if (phase === 'running') return 'Applying';
	if (counts.failed && !counts.landed) return 'Failed';
	if (counts.failed) return `Applied, ${counts.failed} failed`;
	if (counts.cancelled) return `Applied, ${counts.cancelled} cancelled`;
	return 'Applied';
}

/** Cancel after current stops the entities not started yet: with none waiting it would do nothing. */
export function canCancel(counts: Record<LineState, number>): boolean {
	return counts.pending > 0;
}
