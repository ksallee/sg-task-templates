/**
 * Run state: what the screens share from Template to Result. One instance, `run`, for the tab; it
 * lives across client-side navigation and the picks (project, type, template, entry) survive a reload.
 *
 * The API the screens use, and nothing else:
 *
 *   await run.start()                 settle the client (live.ts) and the reads the current picks need
 *   run.project, run.entityType,      the picks, read-only; change them with setProject, setEntityType,
 *   run.templateId, run.template,     setTemplate, setListFilter, setSelected (each clears the plans
 *   run.listFilter, run.selected      it makes stale; a new project, type or template resets the filter)
 *   run.types, run.templates,         reads, as `Loadable`: templatable types (cached per session), every
 *   run.defaultTemplate               template with tasks and edges, the project's default for the type (088)
 *   await run.countMatching(f, text)  how many entities a list filter matches (`_summarize`, 020)
 *   run.ctx, run.snapshots,           after buildPlans(): the project's Task statuses, the frozen reads,
 *   run.plans, run.options,           one EntityPlan per entity (planRun), the options they were built
 *   run.access, run.planning          with, the access summary (094; value null = nothing to check on)
 *   await run.buildPlans()            read snapshots in batches, plan, check access; nothing writes
 *   run.setOptions(next)              replan from the held snapshots with new options; no read
 *   run.client()                      the signed-in client, for the apply and the undo
 *   await run.resumeRun(stored, rest) a stored run's picks and options, its remaining entities re-planned
 *
 * Every read here goes through `$lib/io/load.ts` and `$lib/io/access.ts`; the logic is in
 * `$lib/pure/entry.ts` and the planner. Nothing on these screens writes to the site.
 */

import type { EntityRef, SgClient } from 'sg-widgets-core';
import { checkAccess } from '$lib/io/access';
import {
	loadTaskFields,
	loadDefaultTemplate,
	loadProjectContext,
	loadSnapshots,
	loadTemplatableTypes,
	loadTemplates,
	searchAll
} from '$lib/io/load';
import { DEFAULT_CONCURRENCY, runPool } from '$lib/io/pool';
import { liveWriter, prepareLive, project as storedProject, setProject as storeProject, type LiveState, type ProjectPick } from '$lib/live';
import {
	accessSample,
	addToSelection,
	chunk,
	defaultRunOptions,
	entityListFilters,
	legacyFilter,
	selectedWithin,
	storedFilter,
	type ListFilter
} from '$lib/pure/entry';
import { planRun } from '$lib/pure/planner';
import { errorOf } from '$lib/pure/run';
import type { AccessSummary, EntityPlan, EntitySnapshot, Id, ProjectContext, Run, RunOptions, Template } from '$lib/pure/types';

export type { ListFilter };

/** A read the screens show: not started, in flight (with progress when known), done, or failed. */
export type Loadable<T> =
	| { state: 'idle' }
	| { state: 'loading'; done?: number; total?: number }
	| { state: 'ready'; value: T }
	| { state: 'error'; message: string };

const IDLE = { state: 'idle' } as const;

/** Entities per snapshot read: each is a handful of `_search` calls with `in` over these (load.ts). */
export const SNAPSHOT_BATCH = 25;

const KEYS = {
	picks: 'sg-task-templates:run',
	types: (site: string, projectId: Id) => `sg-task-templates:types:${site}:${projectId}`
} as const;

interface Picks {
	entityType: string | null;
	templateId: Id | null;
	listFilter: ListFilter | null;
	/** Retired in #59; read once, as the filter it implied. */
	entryPoint?: unknown;
}

function readJson<T>(storage: () => Storage, key: string): T | null {
	try {
		const raw = storage().getItem(key);
		return raw === null ? null : (JSON.parse(raw) as T);
	} catch {
		return null;
	}
}

function writeJson(storage: () => Storage, key: string, value: unknown): void {
	try {
		storage().setItem(key, JSON.stringify(value));
	} catch {
		/* Remembering is a convenience. */
	}
}

const failed = (error: unknown): { state: 'error'; message: string } => ({ state: 'error', message: errorOf(error).message });

class RunState {
	project = $state<ProjectPick | null>(null);
	entityType = $state<string | null>(null);
	templateId = $state<Id | null>(null);
	/** The entities list's filter; null until the list opens (entry.ts `openingFilter`). */
	listFilter = $state<ListFilter | null>(null);
	selected = $state.raw<EntityRef[]>([]);

	types = $state.raw<Loadable<string[]>>(IDLE);
	templates = $state.raw<Loadable<Template[]>>(IDLE);
	/** Task field display names by code name, project-scoped (Task schema with `project_id`). */
	fieldLabels = $state.raw<Record<string, string>>({});
	defaultTemplate = $state.raw<Loadable<EntityRef | null>>(IDLE);

	ctx = $state.raw<ProjectContext | null>(null);
	snapshots = $state.raw<EntitySnapshot[]>([]);
	plans = $state.raw<EntityPlan[]>([]);
	options = $state.raw<RunOptions | null>(null);
	access = $state.raw<Loadable<AccessSummary | null>>(IDLE);
	planning = $state.raw<Loadable<true>>(IDLE);

	/** The picked template, once the templates are read. */
	template = $derived.by((): Template | null => {
		const all = this.templates;
		return all.state === 'ready' ? (all.value.find((t) => t.id === this.templateId) ?? null) : null;
	});

	#live: LiveState | null = null;
	#started: Promise<void> | null = null;
	#templateCache = new Map<Id, Promise<{ templates: Template[]; labels: Record<string, string> }>>();

	constructor() {
		this.project = storedProject();
		const picks = readJson<Picks>(() => localStorage, KEYS.picks);
		if (picks) {
			this.entityType = picks.entityType ?? null;
			this.templateId = picks.templateId ?? null;
			this.listFilter = storedFilter(picks.listFilter, picks.entryPoint);
		}
	}

	/** The signed-in client. Throws before `start()` has settled. */
	client(): SgClient {
		return liveWriter();
	}

	/** Settle the site, then read what the remembered picks need. Safe to call from every screen. */
	start(): Promise<void> {
		this.#started ??= prepareLive().then((live) => {
			this.#live = live;
			if (live.problem) return;
			this.#readForProject();
		});
		return this.#started;
	}

	/** The problem that stops every read (no site, no sign-in), once `start()` has settled. */
	get problem(): string | null {
		return this.#live?.problem ?? null;
	}

	setProject(next: ProjectPick | null): void {
		if (next?.id === this.project?.id) return;
		this.project = next;
		storeProject(next);
		this.types = IDLE;
		this.templates = IDLE;
		this.defaultTemplate = IDLE;
		this.listFilter = null;
		this.selected = [];
		this.#clearPlans();
		this.#readForProject();
	}

	setEntityType(next: string | null): void {
		if (next === this.entityType) return;
		this.entityType = next;
		this.templateId = null;
		this.listFilter = null;
		this.selected = [];
		this.#clearPlans();
		this.#save();
		this.#readDefault(true);
	}

	setTemplate(id: Id | null): void {
		if (id === this.templateId) return;
		this.templateId = id;
		this.listFilter = null;
		this.selected = [];
		this.#clearPlans();
		this.#save();
	}

	/** The list's Show filter. Not a new run: the picks stay, and the page says how many it hides. */
	setListFilter(next: ListFilter | null): void {
		this.listFilter = next;
		this.#save();
	}

	setSelected(refs: EntityRef[]): void {
		this.selected = refs;
		this.#clearPlans();
	}

	/** Select every entity the list's filter matches, on every page, not the loaded ones only. */
	async selectAllMatching(search: string): Promise<void> {
		const project = this.project;
		const type = this.entityType;
		if (!project || !type) return;
		const rows = await searchAll(this.client(), type, entityListFilters(project.id, this.listFilter ?? 'all', this.templateId, search), ['code']);
		const code = (row: (typeof rows)[number]) => (typeof row.attributes?.code === 'string' ? row.attributes.code : undefined);
		this.setSelected(addToSelection(this.selected, rows.map((row) => ({ type: row.type, id: row.id, name: code(row) }))));
	}

	/** How many picks the list filter matches, in one `_summarize` count (020). Null when none are picked. */
	async countSelectedShown(search: string): Promise<number | null> {
		const project = this.project;
		const type = this.entityType;
		const picked = this.selected;
		if (!project || !type || picked.length === 0) return null;
		const filters = selectedWithin(entityListFilters(project.id, this.listFilter ?? 'all', this.templateId, search), picked);
		return this.#count(type, filters);
	}

	/** How many of the type's entities `filter` matches, with the code search. Null before the picks. */
	async countMatching(filter: ListFilter, search: string): Promise<number | null> {
		const project = this.project;
		const type = this.entityType;
		if (!project || !type) return null;
		return this.#count(type, entityListFilters(project.id, filter, this.templateId, search));
	}

	async #count(type: string, filters: ReturnType<typeof entityListFilters>): Promise<number | null> {
		const summary = await this.client().summarize(type, { filters, summaryFields: [{ field: 'id', type: 'count' }] });
		const count = summary.summaries['id'];
		return typeof count === 'number' ? count : null;
	}

	/**
	 * Read the selected entities in batches (`SNAPSHOT_BATCH`, about four in flight), plan them with
	 * fresh default options, then run the access check on one sample (094). Resolves true when there
	 * are plans to show; `planning` holds the progress and any failure. An access check that fails
	 * leaves the plans standing, with `access` in error.
	 */
	async buildPlans(): Promise<boolean> {
		const project = this.project;
		const template = this.template;
		const selected = this.selected;
		if (!project || !template || selected.length === 0) return false;
		const client = this.client();
		const projectRef: EntityRef = { type: 'Project', id: project.id, name: project.name };
		const batches = chunk(selected, SNAPSHOT_BATCH);
		let done = 0;
		this.#clearPlans();
		this.planning = { state: 'loading', done, total: selected.length };
		try {
			const ctx = await loadProjectContext(client, projectRef);
			const read = await runPool(batches, DEFAULT_CONCURRENCY, async (batch) => {
				const snaps = await loadSnapshots(client, batch, template);
				done += batch.length;
				this.planning = { state: 'loading', done, total: selected.length };
				return snaps;
			});
			const snapshots = read.flat();
			const options = defaultRunOptions(ctx);
			this.ctx = ctx;
			this.snapshots = snapshots;
			this.options = options;
			this.plans = planRun(template, snapshots, ctx, options);
			this.planning = { state: 'ready', value: true };
		} catch (error) {
			this.planning = failed(error);
			return false;
		}
		await this.#checkAccess(projectRef, template);
		return true;
	}

	/**
	 * Resume (brief 6): the picks of a stored run, then `remaining` re-planned from a fresh read,
	 * with the run's options carried over. Resolves as `buildPlans` does.
	 */
	async resumeRun(stored: Run, remaining: EntityRef[]): Promise<boolean> {
		await this.start();
		const type = remaining[0]?.type ?? stored.entities[0]?.entity.type ?? null;
		this.setProject({ id: stored.project.id, name: stored.project.name });
		this.setEntityType(type);
		this.setTemplate(stored.template.id);
		// A run saved before #59 reopens on the filter its entry point implied; a newer one on the list's own.
		this.setListFilter(legacyFilter(stored.entryPoint));
		await this.#templateCache.get(stored.project.id)?.catch(() => undefined);
		this.setSelected(remaining);
		const planned = await this.buildPlans();
		if (planned) this.setOptions(stored.options);
		return planned;
	}

	/** New options, same reads: the plan screen's every change goes through here (pure, no I/O). */
	setOptions(next: RunOptions): void {
		const template = this.template;
		if (!template || !this.ctx) return;
		this.options = next;
		this.plans = planRun(template, this.snapshots, this.ctx, next);
	}

	async #checkAccess(project: EntityRef, template: Template): Promise<void> {
		const sample = accessSample(this.plans, this.snapshots, template);
		if (!sample) {
			this.access = { state: 'ready', value: null };
			return;
		}
		this.access = { state: 'loading' };
		try {
			const summary = await checkAccess(this.client(), { ...sample, project });
			this.access = { state: 'ready', value: summary };
		} catch (error) {
			this.access = failed(error);
		}
	}

	#clearPlans(): void {
		this.ctx = null;
		this.snapshots = [];
		this.plans = [];
		this.options = null;
		this.access = IDLE;
		this.planning = IDLE;
	}

	#save(): void {
		writeJson(() => localStorage, KEYS.picks, {
			entityType: this.entityType,
			templateId: this.templateId,
			listFilter: this.listFilter
		} satisfies Picks);
	}

	#readForProject(): void {
		if (!this.#live || this.#live.problem || !this.project) return;
		void this.#readTypes();
		void this.#readTemplates();
		this.#readDefault(false);
	}

	/**
	 * Which types take a template: one schema read per site type (load.ts, about a hundred on the
	 * sandbox), so the answer is kept for the browser session, per site and project.
	 */
	async #readTypes(): Promise<void> {
		const project = this.project;
		const site = this.#live?.siteUrl ?? '';
		if (!project) return;
		const key = KEYS.types(site, project.id);
		const cached = readJson<string[]>(() => sessionStorage, key);
		if (Array.isArray(cached)) {
			this.types = { state: 'ready', value: cached };
			return;
		}
		this.types = { state: 'loading' };
		try {
			const value = await loadTemplatableTypes(this.client(), project.id);
			if (this.project?.id !== project.id) return;
			writeJson(() => sessionStorage, key, value);
			this.types = { state: 'ready', value };
		} catch (error) {
			if (this.project?.id === project.id) this.types = failed(error);
		}
	}

	/** Every template with its tasks and edges, and the project's custom Task fields they carry. */
	async #readTemplates(): Promise<void> {
		const project = this.project;
		if (!project) return;
		this.templates = { state: 'loading' };
		let pending = this.#templateCache.get(project.id);
		if (!pending) {
			const client = this.client();
			pending = loadTaskFields(client, project.id).then(async ({ custom, labels }) => ({ templates: await loadTemplates(client, custom), labels }));
			this.#templateCache.set(project.id, pending);
			pending.catch(() => this.#templateCache.delete(project.id));
		}
		try {
			const { templates: value, labels } = await pending;
			if (this.project?.id === project.id) {
				this.fieldLabels = labels;
				this.templates = { state: 'ready', value };
			}
		} catch (error) {
			if (this.project?.id === project.id) this.templates = failed(error);
		}
	}

	/** The default template for the type (088); pre-selected when nothing is picked yet. */
	#readDefault(preselect: boolean): void {
		const project = this.project;
		const type = this.entityType;
		if (!this.#live || this.#live.problem || !project || !type) {
			this.defaultTemplate = IDLE;
			return;
		}
		this.defaultTemplate = { state: 'loading' };
		loadDefaultTemplate(this.client(), project.id, type).then(
			(value) => {
				if (this.project?.id !== project.id || this.entityType !== type) return;
				this.defaultTemplate = { state: 'ready', value };
				if (value && this.templateId === null && preselect) this.setTemplate(value.id);
			},
			(error) => {
				if (this.project?.id === project.id && this.entityType === type) this.defaultTemplate = failed(error);
			}
		);
	}
}

/** The tab's one run. */
export const run = new RunState();
