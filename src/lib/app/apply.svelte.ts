/**
 * Apply and result state: the run on screen, its live lines, this session's outcomes, the undo.
 * One instance, `session`, for the tab, beside `run` (run.svelte.ts), whose plans it writes.
 *
 *   await session.open()             open the undo store (IndexedDB, else memory: `persistent` false)
 *   session.persistent               false = undo is download-only for this tab
 *   await session.start()            apply `run.plans` (the writable ones), about four in flight;
 *   session.starting                 true from the call until the run's first line shows
 *   session.cancel()                 cancel after current: the in-flight entities finish, no more start
 *   session.current, .lines,         the run on screen, one line per entity, this session's outcomes
 *   .outcomes, .phase
 *   await session.retry(keys)        retry failed entities: phase 1 landed, from the read-back; else 'plan':
 *                                    the entities are read and planned again on /plan (never the old batch)
 *   await session.undo(keys?)        undo some entities, or every landed one (revert.ts)
 *   session.download()               the run's undo records as a JSON file
 *   await session.readFile(file)     an uploaded undo file, run by run, nothing undone yet (fileRuns)
 *   await session.undoFromFile(recs) undo those records once confirmed; undone ones are refused
 *   session.undoProgress             entities undone so far of the undo in flight
 *   await session.show(runId)        a stored run on the result screen (recovered first)
 *   session.unfinished               stored runs with no finish and no tab applying them, for the resume banner
 *   session.stored                   every stored run, for /result when this tab has none (refreshStored)
 *   session.liveElsewhere            the run on screen is being applied in another tab
 *
 * IndexedDB is the truth across tabs: a write in another tab (BroadcastChannel) or the tab's focus
 * reads the run on screen and the lists again. A tab applying a run holds its Web Lock (liveness.ts).
 *   await session.continueRun(id)    recover, re-plan what never landed (the plan loading from the call on)
 *   await session.close(id)          mark a stored run finished: no longer offered
 *
 * Logic is in `$lib/pure/apply-view.ts` and `$lib/pure/result-view.ts`; I/O in `$lib/io/`.
 */

import { applyRun, plannedMap, retryFailed, type EntityOutcome } from '$lib/io/apply';
import type { RevertOutcome } from '$lib/io/revert';
import { holdRun, liveRuns } from '$lib/io/liveness';
import { openStoredRun, snapshotReader, undoRecords } from '$lib/io/session';
import { downloadUndoFile, openUndoStore, readUndoFile, type UndoStore } from '$lib/io/undo-store';
import { whoAmI } from '$lib/live';
import {
	applyEvent,
	cancelPending,
	initialLines,
	linesFromRun,
	newRun,
	resumedRun,
	writablePlans,
	type EntityLine
} from '$lib/pure/apply-view';
import { fileRuns, undoFileName, type FileRun } from '$lib/pure/result-view';
import { entityKey, errorOf, undoRecordsOf } from '$lib/pure/run';
import type { EntityPlan, EntityRef, EntitySnapshot, ProjectContext, Run, UndoRecord } from '$lib/pure/types';
import { run } from './run.svelte';

export type Phase = 'idle' | 'running' | 'done';

/** The dev script key has no HumanUser behind it: the run records that, not a made-up person. */
const SCRIPT_USER: EntityRef = { type: 'ApiUser', id: 0, name: 'dev script key' };

class ApplySession {
	persistent = $state(true);
	phase = $state<Phase>('idle');
	stopping = $state(false);
	current = $state.raw<Run | null>(null);
	lines = $state.raw<EntityLine[]>([]);
	outcomes = $state.raw<EntityOutcome[]>([]);
	finished = $state(0);
	error = $state<string | null>(null);

	/** The last undo: per entity outcome, and whether it is running. */
	undoing = $state(false);
	undone = $state.raw<RevertOutcome[]>([]);
	undoProgress = $state<{ finished: number; total: number } | null>(null);

	unfinished = $state.raw<Run[]>([]);
	stored = $state.raw<Run[]>([]);
	liveElsewhere = $state(false);

	/** Between the confirm and the run's first line: the undo store and the user are read. */
	starting = $state(false);

	/** The `run.plans` the last start wrote: the apply screen shows that run while the plans stand. */
	source = $state.raw<EntityPlan[] | null>(null);

	/** A stored run being continued: the next start writes into it (brief 6). */
	resuming = $state.raw<Run | null>(null);

	#store: Promise<UndoStore> | null = null;
	#plans: EntityPlan[] = [];
	#snapshots: EntitySnapshot[] = [];
	#ctx: ProjectContext | null = null;
	#stop = false;

	open(): Promise<UndoStore> {
		this.#store ??= openUndoStore().then((store) => {
			this.persistent = store.persistent;
			store.onChange((runId) => void this.#changed(store, runId));
			if (typeof window !== 'undefined') window.addEventListener('focus', () => void this.#changed(store, null));
			return store;
		});
		return this.#store;
	}

	/** Another tab wrote `runId` (null: the tab got focus, anything may have changed). */
	async #changed(store: UndoStore, runId: string | null): Promise<void> {
		if (this.liveElsewhere && this.current) this.liveElsewhere = await isLive(this.current.id);
		if (this.phase !== 'running' && !this.undoing && (runId === null || runId === this.current?.id)) await this.#reload(store);
		await this.refreshUnfinished();
		if (this.stored.length || runId === null) await this.refreshStored();
	}

	async refreshStored(): Promise<void> {
		const store = await this.open();
		this.stored = await store.allRuns();
	}

	/** The plans this session can retry, by entity key. */
	get retryable(): ReadonlySet<string> {
		return new Set(this.#plans.map((p) => entityKey(p.entity)));
	}

	get plans(): EntityPlan[] {
		return this.#plans;
	}

	/** The records a download or a run undo takes: every landed entity not undone yet. */
	records(): UndoRecord[] {
		return this.current ? undoRecordsOf(this.current) : [];
	}

	async start(): Promise<void> {
		const template = run.template;
		const ctx = run.ctx;
		const options = run.options;
		const project = run.project;
		if (this.phase === 'running' || this.starting || !template || !ctx || !options || !project) return;
		this.starting = true;
		this.error = null;
		let store: UndoStore;
		let user: Awaited<ReturnType<typeof whoAmI>> | null;
		try {
			store = await this.open();
			user = await whoAmI().catch(() => null);
		} catch (e) {
			this.error = errorOf(e).message;
			return;
		} finally {
			this.starting = false;
		}
		const plans = writablePlans(run.plans);
		const client = run.client();
		const resuming = this.resuming?.template.id === template.id ? this.resuming : null;
		const header = resuming
			? resumedRun(resuming, plans, options)
			: newRun({
					id: crypto.randomUUID(),
					project: { type: 'Project', id: project.id, name: project.name },
					template: { id: template.id, code: template.code },
					user: user ? { type: user.type, id: user.id, name: typeof user.attributes?.name === 'string' ? user.attributes.name : undefined } : SCRIPT_USER,
					options,
					plans,
					now: new Date().toISOString()
				});
		this.resuming = null;
		this.liveElsewhere = false;
		this.source = run.plans;
		this.#plans = plans;
		this.#snapshots = run.snapshots;
		this.#ctx = ctx;
		this.#stop = false;
		this.stopping = false;
		this.error = null;
		this.undone = [];
		this.current = header;
		this.outcomes = [];
		this.finished = 0;
		this.lines = initialLines(plans);
		this.phase = 'running';
		try {
			this.outcomes = await holdRun(header.id, () => applyRun(header, plans, ctx, {
				client,
				read: snapshotReader(client, template),
				store,
				planned: plannedMap(this.#snapshots),
				shouldStop: () => this.#stop,
				onProgress: (p) => {
					this.lines = applyEvent(this.lines, p);
					if (p.state === 'done' || p.state === 'failed') this.finished = p.finished;
				}
			}));
		} catch (e) {
			this.error = errorOf(e).message;
		}
		if (this.#stop) this.lines = cancelPending(this.lines);
		await this.#reload(store);
		this.phase = 'done';
	}

	cancel(): void {
		this.#stop = true;
		this.stopping = true;
	}

	/**
	 * Retry failed entities. One whose phase 1 landed (read_back, after_apply) goes on from a fresh
	 * read-back. Any other is never sent again as planned: it is read and planned again on /plan,
	 * which shows it before Apply ('plan'; the caller opens /plan).
	 */
	async retry(keys: string[]): Promise<'plan' | 'done'> {
		const current = this.current;
		const ctx = this.#ctx;
		const template = run.template;
		if (!current || !ctx || !template || this.phase === 'running') return 'done';
		const store = await this.open();
		const wanted = new Set(keys);
		const failed = this.outcomes.filter((o) => wanted.has(entityKey(o.entity)) && o.result.kind === 'failed');
		const resumable = failed.filter((o) => o.prepared && (o.stage === 'read_back' || o.stage === 'after_apply'));
		const replan = failed.filter((o) => !resumable.includes(o)).map((o) => o.entity);
		if (replan.length) {
			run.setSelected(replan);
			void run.buildPlans();
			return 'plan';
		}
		const items = resumable.flatMap((outcome) => {
			const plan = this.#plans.find((p) => entityKey(p.entity) === entityKey(outcome.entity));
			return plan ? [{ plan, stage: outcome.stage, prepared: outcome.prepared }] : [];
		});
		if (!items.length) return 'done';
		const client = run.client();
		const again = new Set(items.map((i) => entityKey(i.plan.entity)));
		this.phase = 'running';
		this.lines = this.lines.map((l) => (again.has(l.key) ? { ...l, state: 'pending', error: null } : l));
		try {
			const outcomes = await holdRun(current.id, () =>
				retryFailed(current, items, ctx, {
					client,
					read: snapshotReader(client, template),
					store,
					onProgress: (p) => (this.lines = applyEvent(this.lines, p))
				})
			);
			const byKey = new Map(outcomes.map((o) => [entityKey(o.entity), o]));
			this.outcomes = this.outcomes.map((o) => byKey.get(entityKey(o.entity)) ?? o);
		} catch (e) {
			this.error = errorOf(e).message;
		}
		await this.#reload(store);
		this.phase = 'done';
		return 'done';
	}

	/** Undo the given entities of the current run, or every landed one. */
	async undo(keys?: string[]): Promise<void> {
		const wanted = keys ? new Set(keys) : null;
		const records = this.records().filter((r) => !wanted || wanted.has(entityKey(r.entity)));
		await this.#undo(records);
	}

	/** An uploaded undo file, run by run, with what the store marks undone. Throws on a bad file. Undoes nothing. */
	async readFile(file: Blob): Promise<FileRun[]> {
		const records = await readUndoFile(file);
		const store = await this.open();
		const stored: Record<string, Run | null> = {};
		for (const id of new Set(records.map((r) => r.runId))) stored[id] = await store.loadRun(id);
		return fileRuns(records, stored);
	}

	/** Undo records from a file, once confirmed. Shows the stored run when there is one. */
	async undoFromFile(records: UndoRecord[]): Promise<void> {
		const store = await this.open();
		const stored = records[0] ? await store.loadRun(records[0].runId) : null;
		if (stored) {
			this.current = stored;
			this.lines = linesFromRun(stored);
		}
		await this.#undo(records);
	}

	async #undo(records: UndoRecord[]): Promise<void> {
		if (!records.length || this.undoing) return;
		const store = await this.open();
		await run.start();
		const client = run.client();
		// The store is the truth: another tab or a file may have undone some since this tab read it.
		const live: UndoRecord[] = [];
		for (const rec of records) {
			const stored = await store.loadRun(rec.runId);
			const status = stored?.entities.find((e) => entityKey(e.entity) === entityKey(rec.entity))?.status;
			if (status?.state !== 'undone') live.push(rec);
		}
		if (!live.length) {
			await this.#reload(store);
			return;
		}
		this.undoing = true;
		this.error = null;
		this.undoProgress = { finished: 0, total: live.length };
		try {
			this.undone = await undoRecords(live, {
				client,
				read: snapshotReader(client, null),
				store,
				onProgress: (p) => (this.undoProgress = { finished: p.finished, total: p.total })
			});
		} catch (e) {
			this.error = errorOf(e).message;
		}
		this.undoing = false;
		this.undoProgress = null;
		await this.#reload(store);
	}

	download(): void {
		const current = this.current;
		if (current) downloadUndoFile(this.records(), undoFileName(current));
	}

	/** A stored run on the result screen, recovered first when it was left unfinished. */
	async show(runId: string): Promise<boolean> {
		if (this.current?.id === runId) return true;
		const store = await this.open();
		await run.start();
		if (run.problem) return false;
		const opened = await openStoredRun(store, runId, snapshotReader(run.client(), null), isLive);
		if (!opened) return false;
		this.liveElsewhere = opened.live;
		this.#plans = [];
		this.#ctx = null;
		this.source = null;
		this.outcomes = [];
		this.undone = [];
		this.current = opened.run;
		this.lines = linesFromRun(opened.run);
		this.phase = 'done';
		return true;
	}

	async refreshUnfinished(): Promise<void> {
		const store = await this.open();
		const runs = await store.unfinishedRuns();
		const busy = await liveRuns();
		if (this.phase === 'running' && this.current) busy.add(this.current.id);
		if (this.resuming) busy.add(this.resuming.id);
		this.unfinished = runs.filter((r) => !busy.has(r.id));
	}

	/**
	 * Recover, then re-plan what never landed. The plan shows as loading from the call on, so /plan
	 * can open at once. 'closed' when nothing is left to apply; 'failed' leaves the error on the plan.
	 */
	async continueRun(runId: string): Promise<'planned' | 'failed' | 'closed'> {
		run.markPlanning();
		try {
			const store = await this.open();
			await run.start();
			if (run.problem) throw new Error(run.problem);
			const opened = await openStoredRun(store, runId, snapshotReader(run.client(), null), isLive);
			if (opened?.live) throw new Error('Another tab is applying this run.');
			if (!opened || !opened.remaining.length) {
				if (opened) {
					await store.finishRun(runId, new Date().toISOString());
					await this.refreshUnfinished();
				}
				run.clearPlanning();
				return 'closed';
			}
			this.resuming = opened.run;
			await this.refreshUnfinished();
			return (await run.resumeRun(opened.run, opened.remaining)) ? 'planned' : 'failed';
		} catch (error) {
			run.planningFailed(error);
			return 'failed';
		}
	}

	async close(runId: string): Promise<void> {
		const store = await this.open();
		await store.finishRun(runId, new Date().toISOString());
		await this.refreshUnfinished();
	}

	async #reload(store: UndoStore): Promise<void> {
		const id = this.current?.id;
		if (!id) return;
		const stored = await store.loadRun(id);
		if (stored) this.current = stored;
		this.persistent = store.persistent;
	}
}

const isLive = async (runId: string) => (await liveRuns()).has(runId);

/** The tab's one apply session. */
export const session = new ApplySession();
