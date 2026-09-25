/**
 * Apply a planned run, entity by entity, about four in flight (brief 6). Thin over the pure
 * modules: batch.ts builds the requests, result.ts reads the outcome, undo.ts builds the record,
 * drift.ts compares reads.
 *
 * Per entity:
 *   1. read the before-snapshot (what undo.ts needs). If it differs from the snapshot the plan was
 *      built on (`planned`), stop: nothing is sent, the entity fails as `changed` with what changed.
 *      A plan is never sent to an entity it was not built for.
 *   2. store the before-snapshot with the batch (resume), send the one `_batch` (098, recipe 020).
 *      113: a failed `_batch` is atomic, a `task_template` apply included: nothing in it lands. The
 *      read after a refusal stays as a safety net; it reports what the entity holds, not a guess.
 *   3. read back, store the undo record at once: the entity has landed;
 *   4. the after-apply phase (`buildAfterApply`: date clears 097, replaced-edge keeps), a SECOND
 *      call, if any; read back again, store the final record. Its refusal leaves phase 1 standing:
 *      the entity fails as `after_apply` with what phase 1 wrote and its record (QA item 1:
 *      tts_bulk_012, 2026-09-25 14:48, phase 1 landed, phase 2 named a Task retired out of band);
 *   5. diff the read-back against the plan (result.ts).
 * A failure stops that entity only; the run goes on.
 *
 * Retry (brief 6) never resends a batch: `replanEntities` reads the entity again, compares it with
 * the plan's snapshot and plans it again with the run's options; the screen shows that, then
 * `retryFailed` applies the new plan. Only an entity whose phase 1 landed resumes from its read-back.
 *
 * Reads are injected (`read`): the read side of the I/O layer builds the `EntitySnapshot`.
 */

import type { SgClient } from 'sg-widgets-core';
import { buildAfterApply, buildEntityWrite, validateRequests } from '$lib/pure/batch';
import { failedEntityResult, resultForEntity } from '$lib/pure/result';
import { buildUndoRecord } from '$lib/pure/undo';
import { clearedDatesFrom, entityKey, errorOf } from '$lib/pure/run';
import { snapshotChanges, type SnapshotChange } from '$lib/pure/drift';
import { planEntity } from '$lib/pure/planner';
import type {
	BatchRequest,
	EntityPlan,
	EntityRef,
	EntityResult,
	EntityRunState,
	EntitySnapshot,
	EntityWrite,
	FailedStage,
	ProjectContext,
	Run,
	RunOptions,
	Template,
	UndoRecord
} from '$lib/pure/types';
import { DEFAULT_CONCURRENCY, runPool } from './pool';
import type { Prepared, UndoStore } from './undo-store';

/** A fresh read of one entity: its Tasks, the TaskDependency rows touching them, usage. */
export type ReadEntity = (entity: EntityRef) => Promise<EntitySnapshot>;

export interface ApplyDeps {
	client: Pick<SgClient, 'batch'>;
	read: ReadEntity;
	store: UndoStore;
	concurrency?: number;
	onProgress?: (p: ApplyProgress) => void;
	now?: () => string;
	/** Cancel after current: checked before each entity starts; true = start no more (the in-flight ones finish). */
	shouldStop?: () => boolean;
	/**
	 * The snapshot each plan was built on, by entity key (`plannedMap`). The read before the write
	 * is compared with it; a difference stops the entity before anything is sent.
	 */
	planned?: ReadonlyMap<string, EntitySnapshot>;
}

/** The plan snapshots by entity key, as `ApplyDeps.planned` takes them. */
export function plannedMap(snapshots: EntitySnapshot[]): Map<string, EntitySnapshot> {
	return new Map(snapshots.map((s) => [entityKey(s.entity), s]));
}

export interface ApplyProgress {
	entity: EntityRef;
	state: EntityRunState['state'];
	/** Entities finished (done or failed) so far, out of `total`. */
	finished: number;
	total: number;
	/** On `failed`: the client's error title, verbatim, where it stopped, what it wrote or found changed. */
	error?: { status: number | null; message: string };
	stage?: FailedStage;
	written?: SnapshotChange[] | null;
	drift?: SnapshotChange[];
}

export type { FailedStage };

export interface EntityOutcome {
	entity: EntityRef;
	result: EntityResult;
	undo: UndoRecord | null;
	/** Set on a failure. */
	stage?: FailedStage;
	/** Phase 1 as sent, when it landed: a retry resumes from the read-back. */
	prepared?: Prepared;
	/** What the read-back found written (null: unread); what changed since the plan (`changed`). */
	written?: SnapshotChange[] | null;
	drift?: SnapshotChange[];
}

const nowIso = () => new Date().toISOString();

/**
 * Run every plan of `run`, `concurrency` at a time. Plans must be for the run's template. Stores
 * the run as given first (its entities pending), then each entity as it goes. A cancel
 * (`shouldStop`) finishes the entities in flight and leaves the rest pending; the run is finished
 * either way, and the outcomes are those of the entities that ran.
 */
export async function applyRun(
	run: Run,
	plans: EntityPlan[],
	ctx: ProjectContext,
	deps: ApplyDeps
): Promise<EntityOutcome[]> {
	await deps.store.saveRun(run);
	const outcomes = await eachEntity(plans, deps, (plan, d) => applyEntity(run, plan, ctx, d));
	await deps.store.finishRun(run.id, (deps.now ?? nowIso)());
	return outcomes;
}

/** The pool, with progress counts over `items`. */
function eachEntity<T>(items: T[], deps: ApplyDeps, work: (item: T, deps: ApplyDeps) => Promise<EntityOutcome>) {
	const total = items.length;
	let finished = 0;
	const tracked: ApplyDeps = {
		...deps,
		onProgress: (p) => deps.onProgress?.({ entity: p.entity, state: p.state, finished, total })
	};
	return runPool(
		items,
		deps.concurrency ?? DEFAULT_CONCURRENCY,
		async (item) => {
			const outcome = await work(item, tracked);
			finished++;
			const r = outcome.result;
			deps.onProgress?.(
				r.kind === 'ok'
					? { entity: outcome.entity, state: 'done', finished, total }
					: { entity: outcome.entity, state: 'failed', finished, total, error: r.error, stage: outcome.stage, written: outcome.written, drift: outcome.drift }
			);
			return outcome;
		},
		deps.shouldStop
	);
}

/** One entity to retry: a plan from `replanEntities`, or, when phase 1 landed, the run's plan and its prepared batch. */
export interface RetryItem {
	plan: EntityPlan;
	stage?: FailedStage;
	prepared?: Prepared | null;
}

/** Phase 1 landed: the retry goes on from the read-back and never sends phase 1 again. */
const landed = (item: RetryItem): item is RetryItem & { prepared: Prepared } =>
	!!item.prepared && (item.stage === 'read_back' || item.stage === 'after_apply');

/**
 * Retry failed entities. One whose phase 1 landed resumes from its read-back (phase 2 is built from
 * that fresh read). Any other is applied from its plan as a new entity would be, and its plan must
 * come from `replanEntities`: `deps.planned` holds the snapshots it was built on. The run was
 * finished once; it is finished again.
 */
export async function retryFailed(run: Run, items: RetryItem[], ctx: ProjectContext, deps: ApplyDeps): Promise<EntityOutcome[]> {
	const outcomes = await eachEntity(items, deps, (item, d) =>
		landed(item) ? finishEntity(run, item.plan, item.prepared, d) : applyEntity(run, item.plan, ctx, d)
	);
	await deps.store.finishRun(run.id, (deps.now ?? nowIso)());
	return outcomes;
}

/** A failed entity read again and planned again. `changes`: since the snapshot its last plan was built on. */
export interface Replan {
	entity: EntityRef;
	snapshot: EntitySnapshot;
	plan: EntityPlan;
	changes: SnapshotChange[];
}

/**
 * The retry's first half (brief 6: preview before write): a fresh read of each entity, compared
 * with the snapshot its plan was built on, planned again with the run's options. Writes nothing.
 * An entity that cannot be read comes back with its error.
 */
export async function replanEntities(
	entities: EntityRef[],
	input: { template: Template; ctx: ProjectContext; options: RunOptions; planned: ReadonlyMap<string, EntitySnapshot>; read: ReadEntity }
): Promise<Array<Replan | { entity: EntityRef; error: string }>> {
	return runPool(entities, DEFAULT_CONCURRENCY, async (entity) => {
		try {
			const snapshot = await input.read(entity);
			const was = input.planned.get(entityKey(entity));
			return {
				entity,
				snapshot,
				plan: planEntity(input.template, snapshot, input.ctx, input.options),
				changes: was ? snapshotChanges(was, snapshot) : []
			};
		} catch (e) {
			return { entity, error: errorOf(e).message };
		}
	});
}

interface FailureFacts {
	undo?: UndoRecord | null;
	prepared?: Prepared;
	written?: SnapshotChange[] | null;
	drift?: SnapshotChange[];
}

function fail(run: Run, entity: EntityRef, e: unknown, stage: FailedStage, deps: ApplyDeps, facts: FailureFacts = {}): Promise<EntityOutcome> {
	const error = errorOf(e);
	const undo = facts.undo ?? null;
	const { written, drift, prepared } = facts;
	// Landed but unread: stays `applying` in the store, so a reopen rebuilds its record (recoverInterrupted).
	const status: EntityRunState =
		stage === 'read_back'
			? { state: 'applying' }
			: {
					state: 'failed',
					error,
					undo,
					stage,
					...(written !== undefined ? { written } : {}),
					...(drift ? { drift } : {})
				};
	return deps.store
		.saveEntity(run.id, entity, status)
		.then(() => ({ entity, result: failedEntityResult(entity, error), undo, stage, prepared, written, drift }));
}

/** One entity, phases 1 to 5. Never throws. */
export async function applyEntity(run: Run, plan: EntityPlan, ctx: ProjectContext, deps: ApplyDeps): Promise<EntityOutcome> {
	let write: EntityWrite;
	try {
		write = buildEntityWrite(plan, run.options, ctx);
	} catch (e) {
		return fail(run, plan.entity, e, 'validate', deps);
	}
	const { entity, batch } = write;
	const invalid = validateRequests(batch, plan);
	if (invalid.length) return fail(run, entity, new Error(invalid.join('; ')), 'validate', deps);

	await deps.store.saveEntity(run.id, entity, { state: 'applying' });
	deps.onProgress?.({ entity, state: 'applying', finished: 0, total: 0 });

	let before: EntitySnapshot;
	try {
		before = await deps.read(entity);
	} catch (e) {
		return fail(run, entity, e, 'read', deps);
	}
	const planned = deps.planned?.get(entityKey(entity));
	const drift = planned ? snapshotChanges(planned, before) : [];
	if (drift.length) return fail(run, entity, new Error('Changed on Flow PT since the plan.'), 'changed', deps, { drift });

	const prepared: Prepared = { before, batch, appliedAt: (deps.now ?? nowIso)() };
	await deps.store.saveEntity(run.id, entity, { state: 'applying' }, prepared);

	if (batch.length) {
		try {
			await deps.client.batch(batch);
		} catch (e) {
			return refused(run, e, prepared, deps);
		}
	}
	return finishEntity(run, plan, prepared, deps);
}

/**
 * Phase 1 refused. 113: the batch is atomic, so nothing of it landed; the read-back is the safety
 * net that says so from Flow PT itself. Anything it finds (someone else's write in the meantime)
 * is listed, with a record to undo it.
 */
async function refused(run: Run, e: unknown, prepared: Prepared, deps: ApplyDeps): Promise<EntityOutcome> {
	const entity = prepared.before.entity;
	const ref: EntityRef = entity.name === undefined ? { type: entity.type, id: entity.id } : { type: entity.type, id: entity.id, name: entity.name };
	let after: EntitySnapshot;
	try {
		after = await deps.read(ref);
	} catch {
		return fail(run, ref, e, 'apply', deps, { written: null, prepared });
	}
	const written = snapshotChanges(prepared.before, after);
	const undo = written.length ? recordOf(run.id, run.template.id, prepared, after) : null;
	return fail(run, ref, e, 'apply', deps, { written, undo });
}

function recordOf(runId: string, templateId: number, prepared: Prepared, after: EntitySnapshot, extra: BatchRequest[] = [], cleared: UndoRecord['clearedDates'] = []) {
	return buildUndoRecord({
		runId,
		templateId,
		appliedAt: prepared.appliedAt,
		before: prepared.before,
		after,
		batch: [...prepared.batch, ...extra],
		clearedDates: cleared
	});
}

/** Phases 3 to 5, from a landed batch. */
async function finishEntity(run: Run, plan: EntityPlan, prepared: Prepared, deps: ApplyDeps): Promise<EntityOutcome> {
	const { entity } = plan;
	const record = (after: EntitySnapshot, extra: BatchRequest[] = [], cleared: UndoRecord['clearedDates'] = []) =>
		recordOf(run.id, plan.templateId, prepared, after, extra, cleared);

	let after: EntitySnapshot;
	try {
		after = await deps.read(entity);
	} catch (e) {
		// Landed, but unread: no record yet. `prepared` is stored; a retry or a reopen rebuilds it.
		return fail(run, entity, e, 'read_back', deps, { prepared });
	}
	let undo = record(after);

	// Phase 2 is built from this read-back, never from the plan's snapshot (113: re-read both ends).
	const afterApply = buildAfterApply(plan, run.options, after);
	if (afterApply.length) {
		const cleared = clearedDatesFrom(afterApply, after.tasks);
		try {
			await deps.client.batch(afterApply);
			after = await deps.read(entity);
		} catch (e) {
			return fail(run, entity, e, 'after_apply', deps, { undo, prepared, written: snapshotChanges(prepared.before, after) });
		}
		undo = record(after, afterApply, cleared);
	}
	await deps.store.saveEntity(run.id, entity, { state: 'done', undo });
	return { entity, result: resultForEntity(plan, prepared.before, after), undo };
}

/**
 * The undo record of an entity whose batch may have landed while no one was looking (a tab closed
 * mid-batch), and what landed: the stored before-snapshot and batch against a fresh read. `written`
 * empty: nothing landed, and the record writes back what is already there.
 */
export async function recoverUndo(
	runId: string,
	templateId: number,
	prepared: Prepared,
	read: ReadEntity
): Promise<{ undo: UndoRecord; written: SnapshotChange[] }> {
	const after = await read(prepared.before.entity);
	return { undo: recordOf(runId, templateId, prepared, after), written: snapshotChanges(prepared.before, after) };
}

export const INTERRUPTED = 'Interrupted: the tab closed while this entity was applying.';

/**
 * On reopen (brief 6), before re-planning, for a run no tab is applying. An entity left `applying`:
 * with no prepared batch it never sent one, and is pending again; with one, a fresh read says
 * whether it landed: nothing written, pending again (re-planned on Continue); something written,
 * failed as `interrupted` with its record, so the re-plan skips it and undo covers it. A refused
 * entity whose read-back failed gets the same read. Returns the run as stored after.
 */
export async function recoverInterrupted(run: Run, read: ReadEntity, store: UndoStore): Promise<Run> {
	const stored = (await store.loadRun(run.id)) ?? run;
	for (const { entity, status } of stored.entities) {
		const unread = status.state === 'failed' && status.written === null;
		if (status.state !== 'applying' && !unread) continue;
		const prepared = await store.prepared(run.id, entity);
		if (!prepared) {
			if (status.state === 'applying') await store.saveEntity(run.id, entity, { state: 'pending' });
			continue;
		}
		try {
			const { undo, written } = await recoverUndo(run.id, run.template.id, prepared, read);
			if (status.state === 'failed') {
				await store.saveEntity(run.id, entity, { ...status, written, undo: written.length ? undo : null });
			} else if (written.length === 0) {
				await store.saveEntity(run.id, entity, { state: 'pending' });
			} else {
				await store.saveEntity(run.id, entity, { state: 'failed', error: { status: null, message: INTERRUPTED }, stage: 'interrupted', written, undo });
			}
		} catch {
			// Unreadable now: left as it is, offered again on the next reopen.
		}
	}
	return (await store.loadRun(run.id)) ?? run;
}
