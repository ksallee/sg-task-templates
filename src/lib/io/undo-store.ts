/**
 * Runs and undo records: IndexedDB when the browser gives it, memory otherwise (private mode,
 * blocked storage). Every write goes to memory first, so a download always has the records; a
 * store that loses IndexedDB mid-run flips `persistent` to false and carries on in memory (the
 * screen then warns that undo is download-only for this run).
 *
 * Layout: `runs` holds each Run without its entities; `entities` holds one row per run and
 * entity, written as the entity lands (brief 6), with the before-snapshot and batch prepared just
 * before sending, so a tab closed mid-batch can still build its record from a fresh read.
 */

import { entityKey } from '$lib/pure/run';
import { parseUndoJson, serializeUndo } from '$lib/pure/undo';
import type { BatchRequest, EntityRef, EntityRunState, EntitySnapshot, Run, UndoRecord } from '$lib/pure/types';

const DB_NAME = 'sg-task-templates';
const DB_VERSION = 1;
const RUNS = 'runs';
const ENTITIES = 'entities';

/** What apply.ts writes before sending an entity's batch: enough to rebuild its undo record. */
export interface Prepared {
	before: EntitySnapshot;
	batch: BatchRequest[];
	appliedAt: string;
}

interface EntityRow {
	runId: string;
	key: string;
	entity: EntityRef;
	status: EntityRunState;
	prepared?: Prepared;
}

export interface UndoStore {
	/** False: IndexedDB is unavailable or failed; records live in memory only, download to keep them. */
	readonly persistent: boolean;
	/** The run header and every entity's state. */
	saveRun(run: Run): Promise<void>;
	saveEntity(runId: string, entity: EntityRef, status: EntityRunState, prepared?: Prepared): Promise<void>;
	finishRun(runId: string, finishedAt: string): Promise<void>;
	loadRun(runId: string): Promise<Run | null>;
	/** Runs with no `finishedAt`, newest first: offered on reopen (brief 6). */
	unfinishedRuns(): Promise<Run[]>;
	prepared(runId: string, entity: EntityRef): Promise<Prepared | null>;
	deleteRun(runId: string): Promise<void>;
	/** Every stored run, finished or not, newest first: /result lists them. */
	allRuns(): Promise<Run[]>;
	/**
	 * `cb(runId)` when another tab of this browser writes a run (BroadcastChannel). IndexedDB is the
	 * truth across tabs: the listener reads the run again. Returns the unsubscribe.
	 */
	onChange(cb: (runId: string) => void): () => void;
	/** Stop listening and broadcasting. */
	close(): void;
}

// --- memory -------------------------------------------------------------------------------------

class Memory {
	runs = new Map<string, Omit<Run, 'entities'>>();
	rows = new Map<string, EntityRow>(); // `${runId}|${key}`

	putRun(run: Run) {
		const { entities, ...header } = run;
		this.runs.set(run.id, header);
		for (const e of entities) this.putRow({ runId: run.id, key: entityKey(e.entity), entity: e.entity, status: e.status });
	}
	putRow(row: EntityRow) {
		const id = `${row.runId}|${row.key}`;
		const prepared = row.prepared ?? this.rows.get(id)?.prepared;
		this.rows.set(id, prepared ? { ...row, prepared } : row);
	}
	rowsOf(runId: string) {
		return [...this.rows.values()].filter((r) => r.runId === runId);
	}
	run(runId: string): Run | null {
		const header = this.runs.get(runId);
		return header ? assemble(header, this.rowsOf(runId)) : null;
	}
	drop(runId: string) {
		this.runs.delete(runId);
		for (const r of this.rowsOf(runId)) this.rows.delete(`${r.runId}|${r.key}`);
	}
}

function assemble(header: Omit<Run, 'entities'>, rows: EntityRow[]): Run {
	return { ...header, entities: rows.map((r) => ({ entity: r.entity, status: r.status })) };
}

const newestFirst = (a: Run, b: Run) => b.startedAt.localeCompare(a.startedAt);

// --- IndexedDB, minimal ---------------------------------------------------------------------------

function done<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function committed(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
	});
}

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
	const req = idb.open(DB_NAME, DB_VERSION);
	req.onupgradeneeded = () => {
		const db = req.result;
		if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { keyPath: 'id' });
		if (!db.objectStoreNames.contains(ENTITIES)) {
			db.createObjectStore(ENTITIES, { keyPath: ['runId', 'key'] }).createIndex('runId', 'runId');
		}
	};
	return done(req);
}

/** Structured clone refuses Svelte proxies and functions: store plain JSON. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The channel runs change on, across the tabs of one browser. */
export const RUNS_CHANNEL = 'sg-task-templates:runs';

class Store implements UndoStore {
	private mem = new Memory();
	private channel: BroadcastChannel | null = null;
	private listeners = new Set<(runId: string) => void>();

	constructor(
		private db: IDBDatabase | null,
		channelName: string = RUNS_CHANNEL
	) {
		// Memory only: another tab could not read the run anyway.
		if (db && typeof BroadcastChannel !== 'undefined') {
			try {
				this.channel = new BroadcastChannel(channelName);
				this.channel.onmessage = (e: MessageEvent) => {
					const runId = (e.data as { runId?: unknown } | null)?.runId;
					if (typeof runId === 'string') for (const cb of this.listeners) cb(runId);
				};
			} catch {
				this.channel = null;
			}
		}
	}

	onChange(cb: (runId: string) => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	close(): void {
		this.channel?.close();
		this.channel = null;
		this.listeners.clear();
	}

	private told(runId: string) {
		try {
			this.channel?.postMessage({ runId });
		} catch {
			/* A tab that misses it reads again on focus. */
		}
	}

	get persistent() {
		return this.db !== null;
	}

	/** One IndexedDB step; on failure the store drops to memory for good. */
	private async idb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T | undefined> {
		if (!this.db) return undefined;
		try {
			return await fn(this.db);
		} catch {
			this.db = null;
			return undefined;
		}
	}

	private write(fn: (tx: IDBTransaction) => void) {
		return this.idb(async (db) => {
			const tx = db.transaction([RUNS, ENTITIES], 'readwrite');
			fn(tx);
			await committed(tx);
		});
	}

	async saveRun(run: Run) {
		this.mem.putRun(run);
		const { entities, ...header } = plain(run);
		await this.write((tx) => {
			tx.objectStore(RUNS).put(header);
			for (const e of entities)
				tx.objectStore(ENTITIES).put({ runId: run.id, key: entityKey(e.entity), entity: e.entity, status: e.status });
		});
		this.told(run.id);
	}

	async saveEntity(runId: string, entity: EntityRef, status: EntityRunState, prepared?: Prepared) {
		const key = entityKey(entity);
		this.mem.putRow({ runId, key, entity, status, prepared });
		const row = plain(this.mem.rows.get(`${runId}|${key}`)!);
		await this.write((tx) => tx.objectStore(ENTITIES).put(row));
		this.told(runId);
	}

	async finishRun(runId: string, finishedAt: string) {
		const header = this.mem.runs.get(runId) ?? (await this.readRun(runId));
		if (!header) return;
		const next = { ...header, finishedAt };
		this.mem.runs.set(runId, next);
		await this.write((tx) => tx.objectStore(RUNS).put(plain(next)));
		this.told(runId);
	}

	private async readRun(runId: string): Promise<Omit<Run, 'entities'> | undefined> {
		return this.idb(async (db) => {
			const tx = db.transaction(RUNS, 'readonly');
			return (await done(tx.objectStore(RUNS).get(runId))) as Omit<Run, 'entities'> | undefined;
		});
	}

	private async readRows(runId: string): Promise<EntityRow[] | undefined> {
		return this.idb(async (db) => {
			const tx = db.transaction(ENTITIES, 'readonly');
			return (await done(tx.objectStore(ENTITIES).index('runId').getAll(runId))) as EntityRow[];
		});
	}

	/** IndexedDB first (a run from an earlier tab), then memory. Loads what it finds into memory. */
	async loadRun(runId: string): Promise<Run | null> {
		const header = await this.readRun(runId);
		const rows = header ? await this.readRows(runId) : undefined;
		if (header && rows) {
			this.mem.runs.set(runId, header);
			for (const r of rows) this.mem.putRow(r);
		}
		return this.mem.run(runId);
	}

	async unfinishedRuns(): Promise<Run[]> {
		return (await this.allRuns()).filter((r) => r.finishedAt === null);
	}

	async allRuns(): Promise<Run[]> {
		const ids = new Set(this.mem.runs.keys());
		const stored = await this.idb(async (db) => {
			const tx = db.transaction(RUNS, 'readonly');
			return (await done(tx.objectStore(RUNS).getAll())) as Array<Omit<Run, 'entities'>>;
		});
		for (const h of stored ?? []) ids.add(h.id);
		const runs: Run[] = [];
		for (const id of ids) {
			const run = await this.loadRun(id);
			if (run) runs.push(run);
		}
		return runs.sort(newestFirst);
	}

	async prepared(runId: string, entity: EntityRef): Promise<Prepared | null> {
		const id = `${runId}|${entityKey(entity)}`;
		if (!this.mem.rows.get(id)?.prepared) await this.loadRun(runId);
		return this.mem.rows.get(id)?.prepared ?? null;
	}

	async deleteRun(runId: string) {
		const keys = this.mem.rowsOf(runId).map((r) => [r.runId, r.key]);
		this.mem.drop(runId);
		await this.write((tx) => {
			tx.objectStore(RUNS).delete(runId);
			for (const k of keys) tx.objectStore(ENTITIES).delete(k);
		});
		this.told(runId);
	}
}

/**
 * Open the store. Never throws: no IndexedDB, a refused open (private mode) or a broken database
 * gives a memory store with `persistent` false.
 */
export async function openUndoStore(idb: IDBFactory | undefined = globalThis.indexedDB, channel: string = RUNS_CHANNEL): Promise<UndoStore> {
	if (!idb) return new Store(null, channel);
	try {
		return new Store(await openDb(idb), channel);
	} catch {
		return new Store(null, channel);
	}
}

// --- file ---------------------------------------------------------------------------------------

/** The run's undo file (undo.ts format), as a Blob to download. */
export function undoFileBlob(records: UndoRecord[]): Blob {
	return new Blob([serializeUndo(records)], { type: 'application/json' });
}

/** Save the undo file through the browser. */
export function downloadUndoFile(records: UndoRecord[], filename: string): void {
	const url = URL.createObjectURL(undoFileBlob(records));
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Read an uploaded undo file. Throws undo.ts's message on anything that is not one. */
export async function readUndoFile(file: Blob): Promise<UndoRecord[]> {
	return parseUndoJson(await file.text());
}
