/**
 * The reads behind a plan: the project context and the entities' snapshots in batches, with the
 * access check (094) started as soon as a batch holds a Task the run will write (keep or claim),
 * so it runs beside the remaining reads. With no such Task anywhere, it starts once every batch is
 * in, on any Task (entry.ts `accessSample`). The reads come in through `deps`, so the ordering is
 * tested without a client.
 */
import type { EntityRef } from 'sg-widgets-core';
import { runPool } from './pool';
import { accessSample, chunk, defaultRunOptions, type AccessSample } from '$lib/pure/entry';
import { planRun } from '$lib/pure/planner';
import type { AccessSummary, EntitySnapshot, ProjectContext, Template } from '$lib/pure/types';

export interface PlanReadDeps {
	context(): Promise<ProjectContext>;
	snapshots(batch: EntityRef[]): Promise<EntitySnapshot[]>;
	access(sample: AccessSample): Promise<AccessSummary>;
}

export interface PlanReadInput {
	template: Template;
	selected: EntityRef[];
	batchSize: number;
	concurrency: number;
	/** Entities read so far, after each batch. */
	onProgress(done: number): void;
}

export interface PlanReads {
	ctx: ProjectContext;
	snapshots: EntitySnapshot[];
	/** The access summary; null when no selected entity has a Task. Settles after the reads may. */
	access: Promise<AccessSummary | null>;
}

export async function readForPlan(deps: PlanReadDeps, input: PlanReadInput): Promise<PlanReads> {
	const { template, selected, batchSize, concurrency, onProgress } = input;
	const context = deps.context();
	let access: Promise<AccessSummary | null> | null = null;
	let done = 0;
	const seen: EntitySnapshot[] = [];

	const read = runPool(chunk(selected, batchSize), concurrency, async (batch) => {
		const snaps = await deps.snapshots(batch);
		done += batch.length;
		onProgress(done);
		seen.push(...snaps);
		if (!access) {
			const ctx = await context;
			// A keep or claim Task only: `accessSample` with no snapshots skips the fallback.
			const sample = accessSample(planRun(template, snaps, ctx, defaultRunOptions(ctx)), [], template);
			if (sample) {
				access = deps.access(sample);
				// Handled by the caller, which may await it after the reads; no unhandled rejection meanwhile.
				access.catch(() => undefined);
			}
		}
		return snaps;
	});
	const [ctx, batches] = await Promise.all([context, read]);
	const snapshots = batches.flat();
	if (!access) {
		const sample = accessSample([], snapshots, template);
		access = sample ? deps.access(sample) : Promise.resolve(null);
	}
	return { ctx, snapshots, access };
}
