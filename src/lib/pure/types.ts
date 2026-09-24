/**
 * Domain types for the pure modules. Every module under `src/lib/pure/` imports these.
 *
 * Two layers:
 *   1. Wire: the API's own shapes, as `_search` and `_batch` return them. `EntityRef` and
 *      `EntityRow` come from `sg-widgets-core`.
 *   2. Domain: flat records the planner works on. `read.ts` is the only code that turns layer 1
 *      into layer 2.
 *
 * Corpus tag `corpus/2026-09-24`, plus the sg-groundtruth #79 probes (092..101, branches
 * probe/79-NNN) and #81 (103..109, probe/81-NNN). Comments name the entry each shape rests on.
 */

import type { EntityRef, EntityRow } from 'sg-widgets-core';

// ---------------------------------------------------------------------------------------------
// 1. Wire
// ---------------------------------------------------------------------------------------------

export type { EntityRef, EntityRow };

/**
 * Element of `Task.upstream_tasks` / `downstream_tasks`: `template_task_id` next to id, name,
 * type (entity_types/TaskTemplate, "Links"). Absent or null on a hand-made link.
 */
export interface TaskLinkRef extends EntityRef {
	type: 'Task';
	template_task_id?: number | null;
}

/** Task attributes the app requests. Dates are "YYYY-MM-DD" (field_types/date). */
export interface TaskAttributes {
	content: string | null; // entity_types/Task: nullable over REST
	sg_status_list: string | null; // field_types/status_list: a bare code
	sg_sort_order: number | null; // 083
	duration: number | null; // minutes (field_types/duration)
	est_in_mins: number | null; // minutes
	sg_description: string | null; // 083
	milestone: boolean; // 083: a milestone reads duration 0
	start_date: string | null;
	due_date: string | null;
	pinned: boolean; // 087
	dependency_violation: boolean; // 087, read only
	created_at: string; // "2026-09-02T15:58:21Z" on _search (field_types/date)
}

/** Relationship keys the app requests on Task. */
export type TaskRelationshipKey =
	| 'entity'
	| 'step'
	| 'project'
	| 'template_task'
	| 'task_template'
	| 'upstream_tasks'
	| 'downstream_tasks'
	| 'task_assignees';

/** TaskDependency row (entity_types/Task "Dependencies", 085). `task` is DOWNSTREAM. */
export interface TaskDependencyAttributes {
	dependency_type: DependencyType;
	offset_days: number | null; // working days, may be negative
	shift_ratio: number | null; // no measured effect (085)
	task_id: number; // read only
	dependent_task_id: number; // read only
	cached_display_name: string; // "Task <task> dependent on Task <dependent_task>"
}

export type DependencyType =
	| 'finish-to-start-next-day' // the default when omitted
	| 'start-to-start'
	| 'finish-to-finish'
	| 'start-to-finish-next-day';

/** `Project.tracking_settings.default_task_template` (088). Absent, {} and a missing key = none. */
export interface DefaultTaskTemplates {
	[entityType: string]:
		| { type: 'TaskTemplate'; id: number; name: string; valid: string }
		| undefined;
}

/** One request of `POST /entity/_batch` (recipe 002). `entity` is the schema name, not the slug. */
export type BatchRequest =
	| { request_type: 'create'; entity: string; data: Record<string, unknown> }
	| { request_type: 'update'; entity: string; record_id: number; data: Record<string, unknown> }
	| { request_type: 'delete'; entity: string; record_id: number };

/** One row of the `_batch` response, in request order (recipe 002). */
export type BatchResultRow =
	| { data: EntityRow } // create
	| { data: EntityRow; links: unknown; status: unknown } // update
	| { request_type: 'delete'; type: string; id: number; uuid: string; did_delete: boolean };

/** `POST /entity/<type>/<id>?revive=1` (048). */
export interface ReviveResult {
	data: { type: string; id: number };
	meta: { did_revive: boolean };
}

// ---------------------------------------------------------------------------------------------
// 2. Domain
// ---------------------------------------------------------------------------------------------

export type Id = number;

/** Normalized `content` + step id. Built only by `matching.ts` (`matchKey`). */
export type MatchKey = string & { readonly __brand: 'MatchKey' };

export interface MatchKeyParts {
	/** NFC, trimmed, inner whitespace runs collapsed to one space, casefolded (Q-D). null -> "". */
	content: string;
	/** A Task without a step matches only Tasks without a step. */
	stepId: Id | null;
}

// --- field policies ---------------------------------------------------------------------------

/** A Task field by its wire name, custom fields included (`sg_priority_1`). */
export type FieldName = string;

/**
 * Built-in fields the apply overwrites on every Task linked to the template when the template
 * task's value is non-empty (102). Custom fields are overwritten the same way: the caller adds the
 * Task's custom fields from the schema. An empty template value never clears.
 */
export const APPLY_RESYNCED_FIELDS = [
	'content',
	'step',
	'est_in_mins',
	'sg_description',
	'sg_sort_order',
	'task_reviewers',
	'milestone'
] as const;

/** 102: `duration` is overwritten only on a Task without dates. */
export const APPLY_RESYNCED_IF_UNDATED = ['duration'] as const;

/**
 * Policy for one field on kept and claimed Tasks. `keep` = read before, write back after the
 * apply, in the same batch (098). `fill_if_empty` is not offered for booleans (Q-F).
 */
export type FieldPolicy = 'keep' | 'overwrite' | 'fill_if_empty';

/** What the run knows about a field under policy. */
export interface PolicyFieldInfo {
	name: FieldName;
	dataType: string; // schema data_type: 'checkbox' has no fill_if_empty
	custom: boolean;
}

/** Per run, by field name. A missing field takes `defaultFieldPolicy`. */
export type FieldPolicies = Record<FieldName, FieldPolicy>;

/** Kevin, after 102: keep by default; the name takes the template's (overwrite), keep on opt-in. */
export const DEFAULT_FIELD_POLICY: FieldPolicy = 'keep';
export const CONTENT_DEFAULT_POLICY: FieldPolicy = 'overwrite';

// --- edges --------------------------------------------------------------------------------------

/** A dependency edge without its row id: enough to create it again (101). */
export interface EdgeSpec {
	downstream: Id; // TaskDependency.task
	upstream: Id; // TaskDependency.dependent_task
	type: DependencyType;
	offsetDays: number | null;
}

/** A dependency edge, between template tasks or between an entity's Tasks. */
export interface Edge extends EdgeSpec {
	id: Id | null; // TaskDependency id; null for a predicted edge
}

// --- tasks --------------------------------------------------------------------------------------

/** Fields shared by a template task and an entity Task. */
export interface TaskCore {
	id: Id;
	content: string | null;
	step: EntityRef | null; // {type:'Step', id, name}
	key: MatchKey;
	status: string | null;
	sortOrder: number | null;
	duration: number | null;
	estInMins: number | null;
	description: string | null;
	milestone: boolean;
	startDate: string | null;
	dueDate: string | null;
	assignees: EntityRef[];
	reviewers: EntityRef[];
	/** Wire values of every field under policy, custom fields included (102). */
	fields: Record<FieldName, unknown>;
}

/** A Task row with `task_template` set and `project` null (entity_types/TaskTemplate). */
export interface TemplateTask extends TaskCore {
	templateId: Id;
}

export interface Template {
	id: Id;
	code: string;
	entityType: string | null; // not enforced (083): a mismatch is a warning only
	tasks: TemplateTask[]; // sorted by sortOrder, then id, nulls last
	edges: Edge[]; // between template task ids
}

/** A Task on an entity. */
export interface EntityTask extends TaskCore {
	entity: EntityRef;
	/** `template_task`, with the template it belongs to when known. */
	templateTask: { id: Id; name?: string; templateId: Id | null } | null;
	pinned: boolean;
	dependencyViolation: boolean;
	createdAt: string; // ISO, normalized by read.ts
}

/** Versions and PublishedFiles pointing at a Task (089: `Version.sg_task`, `PublishedFile.task`). */
export interface TaskUsage {
	versions: number;
	publishedFiles: number;
}

/** Everything the planner needs about one entity. Read by the I/O layer, frozen before planning. */
export interface EntitySnapshot {
	entity: EntityRef & { entityType: string; taskTemplate: EntityRef | null };
	tasks: EntityTask[];
	edges: Edge[]; // TaskDependency rows touching these Tasks
	usage: Record<Id, TaskUsage>; // by Task id; missing = zero
	readAt: string; // ISO, for the resume flow
}

export interface ProjectContext {
	project: EntityRef;
	defaultTaskStatus: string; // Task.sg_status_list default_value for the project
	validTaskStatuses: string[]; // valid_values minus hidden_values (field_types/status_list)
}

// --- matching -----------------------------------------------------------------------------------

/** Why the pre-pick chose its first candidate: the first criterion that separated the top two. */
export type PickReason = 'only' | 'usage' | 'status' | 'oldest' | 'id';

export interface PrePick {
	order: EntityTask[]; // best first
	pick: Id;
	reason: PickReason;
}

/**
 * One key the user must resolve. Either several Tasks for one template task, or a template with
 * several tasks of one key (Q-E), or both. Tasks already linked to a template task of this key
 * are not here: the link wins (decisions).
 */
export interface MatchConflict {
	key: MatchKey;
	templateTaskIds: Id[]; // template sort order
	candidates: Id[]; // pre-pick order
	/** Pre-pick: best candidate to the first template task, and so on. Unpaired = create / extra. */
	prePick: Record<Id, Id>; // template task id -> Task id
	reason: PickReason;
}

export type ExtraReason =
	| 'not_in_template' // no template task has its key
	| 'link_wins' // same key as a template task another Task is already linked to
	/**
	 * Set by the planner once a conflict is resolved. A loser linked to one of the conflict's
	 * template tasks (`task.templateTask.id` in the ConflictRow's `templateTasks`) is unlinked
	 * (`template_task` null) in the batch before the template write: at most one Task per template
	 * task, or the server picks one unpredictably (106). It is then outside T for the edge rules.
	 */
	| 'conflict_loser';

/** What `matching.ts` finds for one entity, before options apply. */
export interface Match {
	keep: Array<{ templateTaskId: Id; taskId: Id; keyMismatch: boolean }>;
	claim: Array<{ templateTaskId: Id; taskId: Id }>;
	create: Id[]; // template task ids
	extra: Array<{ taskId: Id; reason: Exclude<ExtraReason, 'conflict_loser'> }>;
	conflict: MatchConflict[];
}

// --- run options --------------------------------------------------------------------------------

export type ExtraAction = 'leave' | 'omit' | 'delete';

export interface RunOptions {
	fieldPolicies: FieldPolicies;
	/** Bulk-set by normalized content; a per-Task choice in `extraOverrides` wins. */
	extraByName: Record<string, ExtraAction>;
	extraOverrides: Record<Id, ExtraAction>;
	omitStatus: string; // a project-valid Task status, e.g. 'omt'; never guessed
	/** Per conflict, by template task id: the Task it takes, or null to create. Absent = pre-pick. */
	conflictPicks: Record<Id, Id | null>;
	/** By TaskDependency id, for edges the apply deletes or replaces. Absent = 'keep'. */
	edgeActions: Record<Id, EdgeAction>;
	/** Offered only for created Tasks with no upstream edge (decisions, 097: they stay unpinned). */
	clearCreatedDates: boolean;
	deleteConfirmed: boolean; // the second confirmation (brief 3)
}

// --- plan -----------------------------------------------------------------------------------------

/** The five plan counts (decisions). keep = already linked to this template's task. */
export type PlanKind = 'keep' | 'claim' | 'create' | 'extra' | 'conflict';

/** A field under policy where the template task's non-empty value differs from the Task's. */
export interface FieldChange {
	field: FieldName;
	current: unknown;
	template: unknown;
	policy: FieldPolicy;
	/** The value after the run: `current` under keep, `template` under overwrite. */
	result: unknown;
}

/** The name changes (content under overwrite). Loud when a linked Task was renamed by hand. */
export interface Rename {
	from: string | null;
	to: string | null;
	handRenamed: boolean;
}

/** A Task already linked to this template's task. */
export interface KeepRow {
	kind: 'keep';
	task: EntityTask;
	templateTask: TemplateTask;
	keyMismatch: boolean; // linked but renamed or moved step: shown, still kept
	fieldChanges: FieldChange[];
	rename: Rename | null;
}

/** A same-key Task whose `template_task` will point at this template's task. */
export interface ClaimRow {
	kind: 'claim';
	task: EntityTask;
	templateTask: TemplateTask;
	previousTemplateTask: EntityTask['templateTask']; // shown in the plan, kept in undo (brief 2)
	fieldChanges: FieldChange[];
	rename: Rename | null;
}

/** A template task no Task matches: the server creates it (083 copies the fields). */
export interface CreateRow {
	kind: 'create';
	templateTask: TemplateTask;
	templateDates: { start: string | null; due: string | null }; // copied verbatim (083)
	/** No upstream edge after apply: the clear-dates option applies (097). */
	datesClearable: boolean;
}

export interface ExtraRow {
	kind: 'extra';
	task: EntityTask;
	action: ExtraAction;
	usage: TaskUsage; // loud warning on delete when non-zero (089)
	reason: ExtraReason;
}

/** Unresolved: shown with its candidates; resolves into keep/claim/create + extras. */
export interface ConflictRow {
	kind: 'conflict';
	key: MatchKey;
	templateTasks: TemplateTask[];
	candidates: Array<{ task: EntityTask; usage: TaskUsage }>; // pre-pick order
	prePick: Record<Id, Id>;
	reason: PickReason;
	/** User override or the pre-pick: template task id -> Task id, null = create. */
	pick: Record<Id, Id | null>;
}

export type PlanRow = KeepRow | ClaimRow | CreateRow | ExtraRow | ConflictRow;

/** An end of an edge after apply: an existing Task, or a template task the server will create. */
export type MappedTask = { existing: Id } | { created: Id /* template task id */ };

/** keep = re-create after the apply in the same batch (new id; may move dates, 092). */
export type EdgeAction = 'keep' | 'remove';

/**
 * An existing edge the apply drops: between two Tasks linked to the template after apply (102), or
 * from a linked Task to an upstream Task not linked to it (109).
 */
export interface AffectedEdge {
	existing: Edge & { id: Id };
	/**
	 * `not_in_template`: both ends linked, T lacks the edge; the apply deletes it (102).
	 * `replaced`: same pair, other type, offset or direction; T's edge takes its place (101, 102).
	 * `outside_upstream`: the downstream end is linked to T, the upstream end is not (an extra, a
	 * conflict loser, a Task linked to another template, a Task on another entity); the apply
	 * erases it, not revivable (109). Keep re-creates it after the apply, like the others.
	 */
	cause: 'not_in_template' | 'replaced' | 'outside_upstream';
	replacedBy: Edge | null; // the template edge, for `replaced`
	/**
	 * Re-creating it after the apply would close a dependency loop (any length) in the after-apply
	 * graph: the server refuses it (085: 2 Tasks; 107: 3+ Tasks, 400) and the whole batch rolls back.
	 * Its action then defaults to 'remove' and the entity carries an `edge_closes_loop` warning.
	 * Absent = no loop.
	 */
	closesLoop?: true;
	action: EdgeAction; // default 'keep'; 'remove' when `closesLoop`
}

export interface EdgePlan {
	/**
	 * Template edges between mapped Tasks the entity lacks: the apply adds them (015, 099) and they
	 * survive the run. See `transientAdded` for copies the batch deletes again.
	 */
	expectedAdded: Array<{ templateEdge: Edge; downstream: MappedTask; upstream: MappedTask }>;
	/** Edges the apply deletes or replaces (101, 102), each with its action. */
	affected: AffectedEdge[];
	/**
	 * Template edges the apply adds on a pair whose `replaced` edge is kept: the batch's after-apply
	 * phase deletes this copy and re-creates the old edge, so it does not survive the run. Not in
	 * `expectedAdded`. Absent = none.
	 */
	transientAdded?: Array<{ templateEdge: Edge; downstream: MappedTask; upstream: MappedTask; keptEdge: Id }>;
	/**
	 * Edges from a linked Task down to a Task not linked to the template: information only, the apply
	 * keeps them (101, 109). Outside-upstream edges are `affected` (109).
	 */
	toExtras: Edge[];
	/** Unpinned Tasks downstream of an added or re-created edge: rescheduled at once (092). */
	mayMove: Id[];
	/** Pinned Tasks downstream of an added edge whose dates break it: flag dependency_violation (092). */
	wouldViolate: Id[];
}

export type PlanWarning =
	| { code: 'template_entity_type_mismatch'; templateType: string | null; entityType: string }
	| { code: 'template_duplicate_key'; key: MatchKey; templateTaskIds: Id[] }
	| { code: 'delete_with_usage'; taskId: Id; usage: TaskUsage }
	| { code: 'rename'; taskId: Id; from: string | null; to: string | null; handRenamed: boolean }
	| {
			code: 'access_short';
			detail: string;
			/** 094: the four probe checks and the schema `editable` read, for the plan screen. */
			checks?: AccessCheck[];
			fields?: Record<FieldName, SchemaFieldAccess>;
	  }
	| { code: 'unresolved_conflict'; templateTaskIds: Id[] }
	/** A kept edge would close a loop after the apply (085, 107): removed by default. */
	| { code: 'edge_closes_loop'; edgeId: Id; action: EdgeAction };

export interface EntityPlan {
	entity: EntitySnapshot['entity'];
	templateId: Id;
	rows: PlanRow[];
	edges: EdgePlan;
	counts: Record<PlanKind, number>;
	warnings: PlanWarning[];
	/** True when `task_template` already equals the template: the write must clear then set (084). */
	needsClearFirst: boolean;
	/** Nothing to write at all. */
	noop: boolean;
}

// --- write -----------------------------------------------------------------------------------------

/** What the batch builder hands the I/O layer for one entity. */
export interface EntityWrite {
	entity: EntityRef;
	/** One `_batch`: claims, `task_template` null then T, write-backs (098). */
	batch: BatchRequest[];
	/** Template task ids whose created Task gets its dates cleared after read-back (097). */
	clearDatesFor: Id[];
}

// --- undo ------------------------------------------------------------------------------------------

/**
 * Everything the full undo needs, in 096's order:
 *   1. `claimed`: write each old `template_task` back;
 *   2. `previousTaskTemplate`: write the entity's old `task_template` back;
 *   3. `created`: delete the Tasks the apply made;
 *   4. write back pre-merge state: `fieldValues`, `omitted`, revive `deletedTasks` (048), remove
 *      `addedEdges`, re-create `droppedEdges` not already re-created (101: erased, not revivable),
 *      revive `deletedEdges` by id (095), restore `clearedDates`.
 */
export interface UndoRecord {
	version: 1;
	runId: string;
	entity: EntityRef;
	templateId: Id;
	appliedAt: string;
	previousTaskTemplate: EntityRef | null;
	claimed: Array<{ taskId: Id; previousTemplateTask: Id | null }>;
	created: Id[];
	/** Pre-apply value of every field under policy on every kept and claimed Task (102). */
	fieldValues: Array<{ taskId: Id; field: FieldName; previous: unknown }>;
	omitted: Array<{ taskId: Id; previousStatus: string | null }>;
	deletedTasks: Id[]; // revive (048, 089)
	/** Every edge the apply deleted or replaced (101, 102), full row; re-create from the spec. */
	droppedEdges: Array<Edge & { id: Id }>;
	/** Dropped edges the run re-created under 'keep': old id -> new id. */
	recreatedEdges: Array<{ previousId: Id; id: Id }>;
	/** Removed by DELETE /entity/task_dependencies/<id>: revive by id (095). */
	deletedEdges: Array<Edge & { id: Id }>;
	/** Added by the apply (015, 099), template replacements included: delete on undo. */
	addedEdges: Array<Edge & { id: Id }>;
	clearedDates: Array<{ taskId: Id; start: string | null; due: string | null }>;
}

// --- run -------------------------------------------------------------------------------------------

export type EntityRunState =
	| { state: 'pending' }
	| { state: 'applying' }
	| { state: 'done'; undo: UndoRecord }
	| { state: 'failed'; error: { status: number | null; message: string }; undo: UndoRecord | null }
	| { state: 'undone'; undo: UndoRecord };

export interface Run {
	version: 1;
	id: string; // uuid
	project: EntityRef;
	template: { id: Id; code: string };
	entryPoint: 'entities_first' | 'template_first' | 'no_template';
	user: EntityRef; // the signed-in HumanUser
	options: RunOptions;
	startedAt: string;
	finishedAt: string | null;
	entities: Array<{ entity: EntityRef; status: EntityRunState }>;
}

// --- access preflight (094) ---------------------------------------------------------------------

/** The four things a run needs to do, each checked before any write lands (094). */
export type AccessCapability = 'update_task' | 'update_entity' | 'create_task' | 'delete_task';

export type AccessResult = 'allowed' | 'refused' | 'unknown';

/**
 * What the I/O layer hands back for one probe call: the HTTP status and the first JSON:API error's
 * `title` and `detail`, kept apart as 017 reads them. `title` carries the update, create and delete
 * refusals and the create check's invalid status (017 `first_error`); `detail` carries the delete
 * check's sentinel (017 `_rolled_back`: a rolled-back `_batch` answers `title` "Not Found"). Both
 * `null` on a 2xx, which has no error body, and `detail` `null` when the error has none.
 */
export interface AccessResponse {
	status: number;
	title: string | null;
	detail: string | null;
}

/** A plain `PUT /entity/<slug>/<id>` (017 `can_update`). `entity` is the schema name; the I/O layer maps the slug. */
export interface AccessPutRequest {
	method: 'PUT';
	entity: string;
	record_id: number;
	body: Record<string, unknown>;
}

/** A plain `POST /entity/<slug>` (017 `can_create_task`). Never a `_batch` create (see below). */
export interface AccessPostRequest {
	method: 'POST';
	entity: string;
	body: Record<string, unknown>;
}

/**
 * The four probe requests for one run (094, 017). Built here; sent and read back by the I/O layer.
 * Only the delete check is a `_batch`: 017 checks create with a plain POST, because a rolled-back
 * `_batch` create moved the parent Shot's `updated_at` in 4 of 15 tries (094).
 */
export interface AccessProbeRequests {
	/**
	 * No-op PUT: the sample Task's current values for the fields the plan will write. `null` when
	 * there are no fields: an empty PUT answers 200 for every caller and tests nothing (094 candidate 5).
	 */
	updateTask: AccessPutRequest | null;
	/** No-op PUT: the entity's current `code`, the field 094 measured (candidate 4, on a Shot). */
	updateEntity: AccessPutRequest;
	/** POST Task with an invalid `sg_status_list`: never lands, whoever the caller is (094 candidate 6). */
	createTask: AccessPostRequest;
	/** `_batch` [delete the sample Task, update of a missing id]: the sentinel rolls it back (094 candidate 9). */
	deleteTask: BatchRequest[];
}

export interface AccessCheck {
	capability: AccessCapability;
	result: AccessResult;
	/** `null` when the call was never made. */
	response: AccessResponse | null;
}

/** `GET /schema/<Type>/fields?project_id=`'s `editable` per field (094): `false` = refused, `true` = maybe. */
export type SchemaFieldAccess = 'refused' | 'maybe';

export interface AccessSummary {
	checks: AccessCheck[];
	fields: Record<FieldName, SchemaFieldAccess>;
	/** A refusal was seen somewhere: the write the plan needs looks short. Unknown never sets this. */
	looksShort: boolean;
}
