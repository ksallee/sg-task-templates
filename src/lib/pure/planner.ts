/**
 * Planner: template + one entity's snapshot + run options -> EntityPlan. Pure, no I/O.
 *
 * Rows come from `matchEntity` (matching.ts). Conflicts resolve to the user's pick or the
 * pre-pick; the conflict row stays in the plan next to the keep/claim/create it resolves to, and
 * the candidates not picked become extras (`conflict_loser`). Counts are rows by kind.
 *
 * Fields: writing `task_template` re-syncs every Task linked to the template (102). A field is
 * under policy when the template task's value is non-empty; `keep` (default) writes the Task's
 * value back, `overwrite` takes the template's, `fill_if_empty` takes it only over an empty value
 * (not on booleans, Q-F). `content` defaults to overwrite; renames are flagged (decisions).
 *
 * Edges come from edges.ts (`planEdges`) on the resolved rows; the planner only reads them for
 * `noop`.
 */

import { mapTasks, planEdges } from "./edges";
import { matchEntity, normalizeContent } from "./matching";
import {
  CONTENT_DEFAULT_POLICY,
  DEFAULT_FIELD_POLICY,
  type ClaimRow,
  type ConflictRow,
  type CreateRow,
  type EntityPlan,
  type EntitySnapshot,
  type EntityTask,
  type ExtraAction,
  type ExtraReason,
  type ExtraRow,
  type FieldChange,
  type FieldName,
  type FieldPolicies,
  type FieldPolicy,
  type Id,
  type KeepRow,
  type MatchConflict,
  type PlanKind,
  type PlanRow,
  type PlanWarning,
  type ProjectContext,
  type Rename,
  type RunOptions,
  type Template,
  type TemplateTask,
  type TaskUsage,
  type EntityRef,
} from "./types";

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

/** 102: the apply keeps status, keeps or fills dates, only fills assignees. Never under policy. */
const NEVER_UNDER_POLICY = new Set([
  "sg_status_list",
  "start_date",
  "due_date",
  "task_assignees",
]);

/** 102, 108: `duration` is re-synced only on a Task with no dates at all; one date set keeps it. */
const DURATION = "duration";

/** Built-ins mirrored on TaskCore, read when `fields` lacks them. */
function coreValue(t: EntityTask | TemplateTask, field: FieldName): unknown {
  switch (field) {
    case "content":
      return t.content;
    case "step":
      return t.step;
    case "est_in_mins":
      return t.estInMins;
    case "sg_description":
      return t.description;
    case "sg_sort_order":
      return t.sortOrder;
    case "task_reviewers":
      return t.reviewers;
    case "milestone":
      return t.milestone;
    case "duration":
      return t.duration;
    default:
      return undefined;
  }
}

function valueOf(t: EntityTask | TemplateTask, field: FieldName): unknown {
  return field in t.fields ? t.fields[field] : coreValue(t, field);
}

/**
 * Empty: null, undefined, "", [], and `false`. A template checkbox left false is treated as
 * empty: it never overwrites (108). A template "" is stored as null (108). 0 is a value (108).
 */
export function isEmptyValue(v: unknown): boolean {
  return (
    v === null ||
    v === undefined ||
    v === "" ||
    v === false ||
    (Array.isArray(v) && v.length === 0)
  );
}

function isRef(v: unknown): v is { type: string; id: number } {
  return typeof v === "object" && v !== null && "type" in v && "id" in v;
}

const refKey = (r: { type: string; id: number }) => `${r.type}:${r.id}`;

/** Entity links by type and id, multi-entity lists as sets, the rest by `===`. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (
    isEmptyValue(a) &&
    isEmptyValue(b) &&
    typeof a !== "boolean" &&
    typeof b !== "boolean"
  )
    return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    const key = (x: unknown) => (isRef(x) ? refKey(x) : JSON.stringify(x));
    const sa = new Set(a.map(key));
    const sb = new Set(b.map(key));
    return sa.size === sb.size && [...sa].every((k) => sb.has(k));
  }
  if (isRef(a) && isRef(b)) return refKey(a) === refKey(b);
  return a === b;
}

/** The policy a field gets when the run does not set one. */
export function policyFor(
  field: FieldName,
  policies: FieldPolicies,
): FieldPolicy {
  return (
    policies[field] ??
    (field === "content" ? CONTENT_DEFAULT_POLICY : DEFAULT_FIELD_POLICY)
  );
}

function templateFields(tpl: TemplateTask): FieldName[] {
  const names = ["content", "step", ...Object.keys(tpl.fields)];
  return [...new Set(names)].filter(
    (f) => !NEVER_UNDER_POLICY.has(f) && !isEmptyValue(valueOf(tpl, f)),
  );
}

/**
 * The fields the apply re-syncs on `task` from `tpl` (102) where the values differ, each with its
 * policy and the value after the run. Booleans have no `fill_if_empty`: it falls back to keep.
 */
export function fieldChanges(
  task: EntityTask,
  tpl: TemplateTask,
  policies: FieldPolicies,
): FieldChange[] {
  const dated = task.startDate !== null || task.dueDate !== null; // 108: either date blocks it
  const out: FieldChange[] = [];
  for (const field of templateFields(tpl)) {
    if (field === DURATION && dated) continue;
    const template = valueOf(tpl, field);
    const current = valueOf(task, field) ?? null;
    if (sameValue(current, template)) continue;
    let policy = policyFor(field, policies);
    if (policy === "fill_if_empty" && typeof template === "boolean")
      policy = "keep";
    const result =
      policy === "overwrite" ||
      (policy === "fill_if_empty" && isEmptyValue(current))
        ? template
        : current;
    out.push({ field, current, template, policy, result });
  }
  return out;
}

/** The fields a run can set a policy on: non-empty on at least one template task. */
export function fieldsUnderPolicy(template: Template): FieldName[] {
  return [...new Set(template.tasks.flatMap(templateFields))];
}

function renameOf(
  task: EntityTask,
  changes: FieldChange[],
  handRenamed: boolean,
): Rename | null {
  const c = changes.find((x) => x.field === "content");
  if (!c || sameValue(c.result, task.content)) return null;
  return { from: task.content, to: c.result as string | null, handRenamed };
}

// ---------------------------------------------------------------------------------------------
// Entity plan
// ---------------------------------------------------------------------------------------------

const ZERO: TaskUsage = { versions: 0, publishedFiles: 0 };

function extraAction(task: EntityTask, opts: RunOptions): ExtraAction {
  return (
    opts.extraOverrides[task.id] ??
    opts.extraByName[normalizeContent(task.content)] ??
    "leave"
  );
}

/** Conflict resolution: valid user picks first, then the pre-pick order for the rest. */
function resolveConflict(
  c: MatchConflict,
  opts: RunOptions,
  warnings: PlanWarning[],
): Record<Id, Id | null> {
  const pick: Record<Id, Id | null> = {};
  const used = new Set<Id>();
  const invalid: Id[] = [];
  for (const ttId of c.templateTaskIds) {
    if (!(ttId in opts.conflictPicks)) continue;
    const p = opts.conflictPicks[ttId];
    if (p === null) pick[ttId] = null;
    else if (c.candidates.includes(p) && !used.has(p)) {
      pick[ttId] = p;
      used.add(p);
    } else invalid.push(ttId);
  }
  if (invalid.length)
    warnings.push({ code: "unresolved_conflict", templateTaskIds: invalid });
  for (const ttId of c.templateTaskIds) {
    if (ttId in pick) continue;
    const next =
      ttId in c.prePick ? c.candidates.find((id) => !used.has(id)) : undefined;
    pick[ttId] = next ?? null;
    if (next !== undefined) used.add(next);
  }
  return pick;
}

/** Plan one entity, edges included (edges.ts). */
export function planEntity(
  template: Template,
  snap: EntitySnapshot,
  ctx: ProjectContext,
  opts: RunOptions,
): EntityPlan {
  const m = matchEntity(
    template,
    snap.tasks,
    snap.usage,
    ctx.defaultTaskStatus,
  );
  const taskById = new Map(snap.tasks.map((t) => [t.id, t]));
  const ttById = new Map(template.tasks.map((t) => [t.id, t]));
  const usage = (id: Id) => snap.usage[id] ?? ZERO;
  const warnings: PlanWarning[] = [];
  const pol = opts.fieldPolicies;

  if (
    template.entityType !== null &&
    template.entityType !== snap.entity.entityType
  ) {
    warnings.push({
      code: "template_entity_type_mismatch",
      templateType: template.entityType,
      entityType: snap.entity.entityType,
    });
  }
  const byKey = new Map<string, Id[]>();
  for (const t of template.tasks)
    byKey.set(t.key, [...(byKey.get(t.key) ?? []), t.id]);
  for (const [key, ids] of byKey) {
    if (ids.length > 1)
      warnings.push({
        code: "template_duplicate_key",
        key: key as TemplateTask["key"],
        templateTaskIds: ids,
      });
  }

  const keepRow = (
    tt: TemplateTask,
    task: EntityTask,
    keyMismatch: boolean,
  ): KeepRow => {
    const fc = fieldChanges(task, tt, pol);
    const handRenamed =
      normalizeContent(task.content) !== normalizeContent(tt.content);
    return {
      kind: "keep",
      task,
      templateTask: tt,
      keyMismatch,
      fieldChanges: fc,
      rename: renameOf(task, fc, handRenamed),
    };
  };
  const claimRow = (tt: TemplateTask, task: EntityTask): ClaimRow => {
    const fc = fieldChanges(task, tt, pol);
    return {
      kind: "claim",
      task,
      templateTask: tt,
      previousTemplateTask: task.templateTask,
      fieldChanges: fc,
      rename: renameOf(task, fc, false),
    };
  };
  const hasUpstream = new Set(template.edges.map((e) => e.downstream));
  const createRow = (tt: TemplateTask): CreateRow => ({
    kind: "create",
    templateTask: tt,
    templateDates: { start: tt.startDate, due: tt.dueDate },
    datesClearable: !hasUpstream.has(tt.id),
  });
  const extraRow = (task: EntityTask, reason: ExtraReason): ExtraRow => {
    const row: ExtraRow = {
      kind: "extra",
      task,
      action: extraAction(task, opts),
      usage: usage(task.id),
      reason,
    };
    const link = task.templateTask?.id;
    const tt = link === undefined ? undefined : ttById.get(link);
    if (tt && row.action !== "delete")
      row.fieldChanges = fieldChanges(task, tt, pol);
    return row;
  };

  // Rows per template task, in template order; a conflict row goes before its first task.
  const byTt = new Map<Id, PlanRow>();
  const conflictBefore = new Map<Id, ConflictRow>();
  const extras: ExtraRow[] = [];

  for (const k of m.keep)
    byTt.set(
      k.templateTaskId,
      keepRow(
        ttById.get(k.templateTaskId)!,
        taskById.get(k.taskId)!,
        k.keyMismatch,
      ),
    );
  for (const c of m.claim)
    byTt.set(
      c.templateTaskId,
      claimRow(ttById.get(c.templateTaskId)!, taskById.get(c.taskId)!),
    );
  for (const id of m.create) byTt.set(id, createRow(ttById.get(id)!));
  const losers: Id[] = [];
  for (const c of m.conflict) {
    const pick = resolveConflict(c, opts, warnings);
    conflictBefore.set(c.templateTaskIds[0], {
      kind: "conflict",
      key: c.key,
      templateTasks: c.templateTaskIds.map((id) => ttById.get(id)!),
      candidates: c.candidates.map((id) => ({
        task: taskById.get(id)!,
        usage: usage(id),
      })),
      prePick: c.prePick,
      reason: c.reason,
      pick,
    });
    for (const ttId of c.templateTaskIds) {
      const tt = ttById.get(ttId)!;
      const taskId = pick[ttId];
      if (taskId === null) byTt.set(ttId, createRow(tt));
      else {
        const task = taskById.get(taskId)!;
        byTt.set(
          ttId,
          task.templateTask?.id === ttId
            ? keepRow(tt, task, task.key !== tt.key)
            : claimRow(tt, task),
        );
      }
    }
    const picked = new Set(Object.values(pick));
    losers.push(...c.candidates.filter((id) => !picked.has(id)));
  }

  const extraReason = new Map<Id, ExtraReason>(
    m.extra.map((e) => [e.taskId, e.reason]),
  );
  for (const id of losers) extraReason.set(id, "conflict_loser");
  for (const t of snap.tasks) {
    const reason = extraReason.get(t.id);
    if (reason) extras.push(extraRow(t, reason));
  }

  const rows: PlanRow[] = [];
  for (const tt of template.tasks) {
    const c = conflictBefore.get(tt.id);
    if (c) rows.push(c);
    const r = byTt.get(tt.id);
    if (r) rows.push(r);
  }
  rows.push(...extras);

  for (const r of rows) {
    if ((r.kind === "keep" || r.kind === "claim") && r.rename)
      warnings.push({ code: "rename", taskId: r.task.id, ...r.rename });
    if (
      r.kind === "extra" &&
      r.action === "delete" &&
      (r.usage.versions > 0 || r.usage.publishedFiles > 0)
    ) {
      warnings.push({
        code: "delete_with_usage",
        taskId: r.task.id,
        usage: r.usage,
      });
    }
  }

  const counts: Record<PlanKind, number> = {
    keep: 0,
    claim: 0,
    create: 0,
    extra: 0,
    conflict: 0,
  };
  for (const r of rows) counts[r.kind]++;

  const plan: EntityPlan = {
    entity: snap.entity,
    templateId: template.id,
    rows,
    edges: planEdges({
      template,
      tasks: snap.tasks,
      edges: snap.edges,
      mapping: mapTasks(rows),
      edgeActions: opts.edgeActions,
    }),
    counts,
    warnings,
    needsClearFirst: snap.entity.taskTemplate?.id === template.id,
    noop: false,
  };
  plan.noop = isNoop(plan, opts);
  return plan;
}

const changes = (fc: FieldChange[] | undefined) =>
  (fc ?? []).some((c) => !sameValue(c.result, c.current));

/**
 * Nothing to write: the entity already has the template, and there is no claim, create, field
 * value to change, omit, confirmed delete, edge to add or edge to remove. Kept hand edits and
 * kept edges do not count: without a template write they stay as they are.
 */
export function isNoop(
  plan: EntityPlan,
  opts?: Pick<RunOptions, "omitStatus" | "deleteConfirmed">,
): boolean {
  if (!plan.needsClearFirst) return false;
  for (const r of plan.rows) {
    if (r.kind === "claim" || r.kind === "create") return false;
    if (r.kind === "keep" && changes(r.fieldChanges)) return false;
    if (r.kind === "extra") {
      if (r.action === "omit" && r.task.status !== opts?.omitStatus)
        return false;
      if (r.action === "delete" && (!opts || opts.deleteConfirmed))
        return false; // unknown = a write
      if (changes(r.fieldChanges)) return false;
    }
  }
  return (
    plan.edges.expectedAdded.length === 0 &&
    plan.edges.affected.every((e) => e.action === "keep")
  );
}

// ---------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------

export function planRun(
  template: Template,
  snaps: EntitySnapshot[],
  ctx: ProjectContext,
  opts: RunOptions,
): EntityPlan[] {
  return snaps.map((s) => planEntity(template, s, ctx, opts));
}

/** Bulk: one extra action for every extra of this (normalized) name, across entities. */
export function withExtraByName(
  opts: RunOptions,
  name: string,
  action: ExtraAction,
): RunOptions {
  return {
    ...opts,
    extraByName: { ...opts.extraByName, [normalizeContent(name)]: action },
  };
}

/** One Task's extra action; wins over the by-name action. */
export function withExtraOverride(
  opts: RunOptions,
  taskId: Id,
  action: ExtraAction,
): RunOptions {
  return {
    ...opts,
    extraOverrides: { ...opts.extraOverrides, [taskId]: action },
  };
}

/** Bulk: one policy for a field across every kept and claimed Task of the run. */
export function withFieldPolicy(
  opts: RunOptions,
  field: FieldName,
  policy: FieldPolicy,
): RunOptions {
  return { ...opts, fieldPolicies: { ...opts.fieldPolicies, [field]: policy } };
}

/** A conflict pick: the Task a template task takes, or null to create. */
export function withConflictPick(
  opts: RunOptions,
  templateTaskId: Id,
  taskId: Id | null,
): RunOptions {
  return {
    ...opts,
    conflictPicks: { ...opts.conflictPicks, [templateTaskId]: taskId },
  };
}

/** Extra names across plans (normalized content) with counts, most frequent first, for the bulk setter. */
export function extraNames(
  plans: EntityPlan[],
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const p of plans) {
    for (const r of p.rows) {
      if (r.kind === "extra") {
        const n = normalizeContent(r.task.content);
        counts.set(n, (counts.get(n) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------
// Entry filters
// ---------------------------------------------------------------------------------------------

type WithTemplate = { taskTemplate: EntityRef | null };

/** Entry point "template first": entities whose `task_template` is this template. */
export function entitiesUsingTemplate<E extends WithTemplate>(
  entities: E[],
  templateId: Id,
): E[] {
  return entities.filter((e) => e.taskTemplate?.id === templateId);
}

/** Entry point "no template": entities with no `task_template`. */
export function entitiesWithoutTemplate<E extends WithTemplate>(
  entities: E[],
): E[] {
  return entities.filter((e) => e.taskTemplate === null);
}

/**
 * The project's default template id for an entity type, from
 * `Project.tracking_settings.default_task_template.<Type>` (088). Absent, `{}` or a missing key = null.
 */
export function defaultTemplateId(
  trackingSettings: unknown,
  entityType: string,
): Id | null {
  if (typeof trackingSettings !== "object" || trackingSettings === null)
    return null;
  const all = (trackingSettings as Record<string, unknown>)
    .default_task_template;
  if (typeof all !== "object" || all === null) return null;
  const ref = (all as Record<string, unknown>)[entityType];
  return isRef(ref) && typeof ref.id === "number" ? ref.id : null;
}
