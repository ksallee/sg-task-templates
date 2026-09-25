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
 *   await session.retry(keys)        retry failed entities this session planned (apply.ts retryFailed)
 *   await session.undo(keys?)        undo some entities, or every landed one (revert.ts)
 *   session.download()               the run's undo records as a JSON file
 *   await session.undoFile(file)     undo a run from an uploaded file (another session's)
 *   await session.show(runId)        a stored run on the result screen (recovered first)
 *   session.unfinished               stored runs with no finish, for the resume banner
 *   await session.continueRun(id)    recover, re-plan what never landed (the plan loading from the call on)
 *   await session.close(id)          mark a stored run finished: no longer offered
 *
 * Logic is in `$lib/pure/apply-view.ts` and `$lib/pure/result-view.ts`; I/O in `$lib/io/`.
 */

import { applyRun, retryFailed, type EntityOutcome } from '$lib/io/apply';
import type { RevertOutcome } from '$lib/io/revert';
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
import { undoFileName } from '$lib/pure/result-view';
import { entityKey, errorOf, undoRecordsOf } from '$lib/pure/run';
import type { EntityPlan, EntityRef, ProjectContext, Run, UndoRecord } from '$lib/pure/types';
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

	unfinished = $state.raw<Run[]>([]);

	/** Between the confirm and the run's first line: the undo store and the user are read. */
	starting = $state(false);

	/** The `run.plans` the last start wrote: the apply screen shows that run while the plans stand. */
	source = $state.raw<EntityPlan[] | null>(null);

	/** A stored run being continued: the next start writes into it (brief 6). */
	resuming = $state.raw<Run | null>(null);

	#store: Promise<UndoStore> | null = null;
	#plans: EntityPlan[] = [];
	#ctx: ProjectContext | null = null;
	#stop = false;

	open(): Promise<UndoStore> {
		this.#store ??= openUndoStore().then((store) => {
			this.persistent = store.persistent;
			return store;
		});
		return this.#store;
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
		this.source = run.plans;
		this.#plans = plans;
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
			this.outcomes = await applyRun(header, plans, ctx, {
				client,
				read: snapshotReader(client, template),
				store,
				shouldStop: () => this.#stop,
				onProgress: (p) => {
					this.lines = applyEvent(this.lines, p);
					if (p.state === 'done' || p.state === 'failed') this.finished = p.finished;
				}
			});
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

	async retry(keys: string[]): Promise<void> {
		const current = this.current;
		const ctx = this.#ctx;
		const template = run.template;
		if (!current || !ctx || !template || this.phase === 'running') return;
		const store = await this.open();
		const client = run.client();
		const wanted = new Set(keys);
		const failed = this.outcomes
			.filter((o) => wanted.has(entityKey(o.entity)) && o.result.kind === 'failed')
			.flatMap((outcome) => {
				const plan = this.#plans.find((p) => entityKey(p.entity) === entityKey(outcome.entity));
				return plan ? [{ plan, outcome }] : [];
			});
		if (!failed.length) return;
		this.phase = 'running';
		this.lines = this.lines.map((l) => (wanted.has(l.key) ? { ...l, state: 'pending', error: null } : l));
		try {
			const again = await retryFailed(current, failed, ctx, {
				client,
				read: snapshotReader(client, template),
				store,
				onProgress: (p) => (this.lines = applyEvent(this.lines, p))
			});
			const byKey = new Map(again.map((o) => [entityKey(o.entity), o]));
			this.outcomes = this.outcomes.map((o) => byKey.get(entityKey(o.entity)) ?? o);
		} catch (e) {
			this.error = errorOf(e).message;
		}
		await this.#reload(store);
		this.phase = 'done';
	}

	/** Undo the given entities of the current run, or every landed one. */
	async undo(keys?: string[]): Promise<void> {
		const wanted = keys ? new Set(keys) : null;
		const records = this.records().filter((r) => !wanted || wanted.has(entityKey(r.entity)));
		await this.#undo(records);
	}

	/** Undo a run from a file: its records, whatever session wrote them. Throws on a bad file. */
	async undoFile(file: Blob): Promise<void> {
		const records = await readUndoFile(file);
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
		this.undoing = true;
		this.error = null;
		try {
			this.undone = await undoRecords(records, { client, read: snapshotReader(client, null), store });
		} catch (e) {
			this.error = errorOf(e).message;
		}
		this.undoing = false;
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
		const opened = await openStoredRun(store, runId, snapshotReader(run.client(), null));
		if (!opened) return false;
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
		const live = this.phase === 'running' ? this.current?.id : null;
		this.unfinished = runs.filter((r) => r.id !== live);
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
			const opened = await openStoredRun(store, runId, snapshotReader(run.client(), null));
			if (!opened || !opened.remaining.length) {
				if (opened) {
					await store.finishRun(runId, new Date().toISOString());
					await this.refreshUnfinished();
				}
				run.clearPlanning();
				return 'closed';
			}
			this.resuming = opened.run;
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

/** The tab's one apply session. */
export const session = new ApplySession();
