/**
 * Apply a planned run, entity by entity, about four in flight (brief 6). Thin over the pure
 * modules: batch.ts builds the requests, result.ts reads the outcome, undo.ts builds the record.
 *
 * Per entity:
 *   1. read the before-snapshot (what undo.ts needs), store it with the batch (resume);
 *   2. send the one `_batch` (098, recipe 020): atomic, a failure lands nothing (002);
 *   3. read back, store the undo record at once: the entity has landed;
 *   4. the after-apply phase (`buildAfterApply`: date clears 097, replaced-edge keeps) if any, read
 *      back again, store the final record;
 *   5. diff the read-back against the plan (result.ts).
 * A failure stops that entity only, with the client's error title verbatim; the run goes on.
 *
 * Reads are injected (`read`): the read side of the I/O layer builds the `EntitySnapshot`.
 */

import type { SgClient } from 'sg-widgets-core';
import { buildAfterApply, buildEntityWrite, validateRequests } from '$lib/pure/batch';
import { failedEntityResult, resultForEntity } from '$lib/pure/result';
import { buildUndoRecord } from '$lib/pure/undo';
import { clearedDatesFrom, errorOf } from '$lib/pure/run';
import type {
	BatchRequest,
	EntityPlan,
	EntityRef,
	EntityResult,
	EntityRunState,
	EntitySnapshot,
	EntityWrite,
	ProjectContext,
	Run,
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
}

export interface ApplyProgress {
	entity: EntityRef;
	state: EntityRunState['state'];
	/** Entities finished (done or failed) so far, out of `total`. */
	finished: number;
	total: number;
	/** On `failed`: the client's error title, verbatim. */
	error?: { status: number | null; message: string };
}

/** Where a failed entity stopped. `after_apply`: phase 1 landed, its record is stored. */
export type FailedStage = 'validate' | 'read' | 'apply' | 'read_back' | 'after_apply';

export interface EntityOutcome {
	entity: EntityRef;
	result: EntityResult;
	undo: UndoRecord | null;
	/** Set on a failure. */
	stage?: FailedStage;
	/** Phase 1 as sent, when it landed: a retry resumes from the read-back. */
	prepared?: Prepared;
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
					: { entity: outcome.entity, state: 'failed', finished, total, error: r.error }
			);
			return outcome;
		},
		deps.shouldStop
	);
}

/**
 * Retry failed entities: the whole entity when nothing landed (the batch is atomic, 002), from the
 * read-back on when phase 1 landed. The run was finished once; it is finished again.
 */
export async function retryFailed(
	run: Run,
	failed: Array<{ plan: EntityPlan; outcome: EntityOutcome }>,
	ctx: ProjectContext,
	deps: ApplyDeps
): Promise<EntityOutcome[]> {
	const outcomes = await eachEntity(failed, deps, ({ plan, outcome }, d) =>
		outcome.prepared && (outcome.stage === 'read_back' || outcome.stage === 'after_apply')
			? finishEntity(run, plan, outcome.prepared, d)
			: applyEntity(run, plan, ctx, d)
	);
	await deps.store.finishRun(run.id, (deps.now ?? nowIso)());
	return outcomes;
}

function fail(
	run: Run,
	entity: EntityRef,
	e: unknown,
	stage: FailedStage,
	deps: ApplyDeps,
	undo: UndoRecord | null = null,
	prepared?: Prepared
): Promise<EntityOutcome> {
	const error = errorOf(e);
	// Landed but unread: stays `applying` in the store, so a reopen rebuilds its record (recoverInterrupted).
	const status: EntityRunState = stage === 'read_back' ? { state: 'applying' } : { state: 'failed', error, undo };
	return deps.store
		.saveEntity(run.id, entity, status)
		.then(() => ({ entity, result: failedEntityResult(entity, error), undo, stage, prepared }));
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
	const prepared: Prepared = { before, batch, appliedAt: (deps.now ?? nowIso)() };
	await deps.store.saveEntity(run.id, entity, { state: 'applying' }, prepared);

	if (batch.length) {
		try {
			await deps.client.batch(batch);
		} catch (e) {
			return fail(run, entity, e, 'apply', deps);
		}
	}
	return finishEntity(run, plan, prepared, deps);
}

/** Phases 3 to 5, from a landed batch. */
async function finishEntity(run: Run, plan: EntityPlan, prepared: Prepared, deps: ApplyDeps): Promise<EntityOutcome> {
	const { entity } = plan;
	const record = (after: EntitySnapshot, extra: BatchRequest[] = [], cleared: UndoRecord['clearedDates'] = []) =>
		buildUndoRecord({
			runId: run.id,
			templateId: plan.templateId,
			appliedAt: prepared.appliedAt,
			before: prepared.before,
			after,
			batch: [...prepared.batch, ...extra],
			clearedDates: cleared
		});

	let after: EntitySnapshot;
	try {
		after = await deps.read(entity);
	} catch (e) {
		// Landed, but unread: no record yet. `prepared` is stored; a retry or a reopen rebuilds it.
		return fail(run, entity, e, 'read_back', deps, null, prepared);
	}
	let undo = record(after);

	const afterApply = buildAfterApply(plan, run.options, after);
	if (afterApply.length) {
		const cleared = clearedDatesFrom(afterApply, after.tasks);
		try {
			await deps.client.batch(afterApply);
			after = await deps.read(entity);
		} catch (e) {
			return fail(run, entity, e, 'after_apply', deps, undo, prepared);
		}
		undo = record(after, afterApply, cleared);
	}
	await deps.store.saveEntity(run.id, entity, { state: 'done', undo });
	return { entity, result: resultForEntity(plan, prepared.before, after), undo };
}

/**
 * The undo record of an entity whose batch may have landed while no one was looking (a tab closed
 * mid-batch): the stored before-snapshot and batch against a fresh read. A batch that never
 * landed gives a record that writes back what is already there.
 */
export async function recoverUndo(runId: string, templateId: number, prepared: Prepared, read: ReadEntity): Promise<UndoRecord> {
	return buildUndoRecord({
		runId,
		templateId,
		appliedAt: prepared.appliedAt,
		before: prepared.before,
		after: await read(prepared.before.entity),
		batch: prepared.batch
	});
}

export const INTERRUPTED = 'Interrupted: the tab closed while this entity was applying. Its undo record was rebuilt from a fresh read.';

/**
 * On reopen (brief 6), before re-planning: every entity left `applying` with a prepared batch gets
 * its record rebuilt and stored as failed-with-record, so the re-plan skips it and undo covers it.
 * One left `applying` without one never sent its batch: it stays remaining. Reads the run's states
 * from the store; returns the run as stored after.
 */
export async function recoverInterrupted(run: Run, read: ReadEntity, store: UndoStore): Promise<Run> {
	const stored = (await store.loadRun(run.id)) ?? run;
	for (const { entity, status } of stored.entities) {
		if (status.state !== 'applying') continue;
		const prepared = await store.prepared(run.id, entity);
		if (!prepared) continue;
		try {
			const undo = await recoverUndo(run.id, run.template.id, prepared, read);
			await store.saveEntity(run.id, entity, { state: 'failed', error: { status: null, message: INTERRUPTED }, undo });
		} catch {
			// Unreadable now: left applying, offered again on the next reopen.
		}
	}
	return (await store.loadRun(run.id)) ?? run;
}
