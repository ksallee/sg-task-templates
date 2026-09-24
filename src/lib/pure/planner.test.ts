import { describe, expect, it } from "vitest";
import { matchKey } from "./matching";
import {
  defaultTemplateId,
  entitiesUsingTemplate,
  entitiesWithoutTemplate,
  extraNames,
  fieldChanges,
  fieldsUnderPolicy,
  isNoop,
  planEntity,
  planRun,
  withConflictPick,
  withEntityConflictPick,
  withExtraByName,
  withExtraOverride,
  withFieldPolicy,
} from "./planner";
import type {
  Edge,
  EntitySnapshot,
  EntityTask,
  FieldName,
  Id,
  ProjectContext,
  RunOptions,
  Template,
  TemplateTask,
  TaskUsage,
} from "./types";

// Steps and ids follow fixtures/recipe015-*.json: Animation 11, Character FX 12, Comp 13, FX 14.
const step = (id: number | null) =>
  id === null ? null : { type: "Step", id, name: `step${id}` };

function core(
  id: Id,
  content: string | null,
  stepId: number | null,
  fields: Record<FieldName, unknown> = {},
) {
  return {
    id,
    content,
    step: step(stepId),
    key: matchKey(content, stepId),
    status: "wtg",
    sortOrder: null,
    duration: null,
    estInMins: null,
    description: null,
    milestone: false,
    startDate: null,
    dueDate: null,
    assignees: [],
    reviewers: [],
    fields: { content, step: step(stepId), ...fields },
  };
}

function tt(
  id: Id,
  content: string,
  stepId: number | null,
  sortOrder: number,
  opts: {
    fields?: Record<FieldName, unknown>;
    start?: string;
    due?: string;
  } = {},
): TemplateTask {
  return {
    ...core(id, content, stepId, opts.fields),
    sortOrder,
    startDate: opts.start ?? null,
    dueDate: opts.due ?? null,
    templateId: 202,
  };
}

function task(
  id: Id,
  content: string | null,
  stepId: number | null,
  opts: {
    link?: Id | null;
    linkTemplate?: Id | null;
    status?: string | null;
    createdAt?: string;
    fields?: Record<FieldName, unknown>;
    start?: string;
    due?: string;
  } = {},
): EntityTask {
  return {
    ...core(id, content, stepId, opts.fields),
    status: opts.status === undefined ? "wtg" : opts.status,
    startDate: opts.start ?? null,
    dueDate: opts.due ?? null,
    entity: { type: "Shot", id: 7557, name: "sh010" },
    templateTask: opts.link
      ? { id: opts.link, templateId: opts.linkTemplate ?? null }
      : null,
    pinned: false,
    dependencyViolation: false,
    createdAt: opts.createdAt ?? "2026-09-02T15:58:21Z",
  };
}

// tt2 of recipe 015: comp@Animation, roto@Comp, paint@FX; paint -> comp start-to-start 1.
const tt2: Template = {
  id: 202,
  code: "tt2",
  entityType: "Shot",
  tasks: [
    tt(47201, "comp", 11, 10),
    tt(47202, "roto", 13, 20, { start: "2026-03-02", due: "2026-03-04" }),
    tt(47203, "paint", 14, 30),
  ],
  edges: [
    {
      id: 900,
      downstream: 47201,
      upstream: 47203,
      type: "start-to-start",
      offsetDays: 1,
    },
  ],
};

const ctx: ProjectContext = {
  project: { type: "Project", id: 1180 },
  defaultTaskStatus: "wtg",
  validTaskStatuses: ["wtg", "ip", "fin", "omt"],
};

const opts: RunOptions = {
  fieldPolicies: {},
  extraByName: {},
  extraOverrides: {},
  omitStatus: "omt",
  conflictPicks: {},
  edgeActions: {},
  clearCreatedDates: false,
  deleteConfirmed: false,
};

function snap(
  tasks: EntityTask[],
  o: {
    usage?: Record<Id, TaskUsage>;
    taskTemplate?: Id | null;
    entityType?: string;
    id?: Id;
    edges?: Edge[];
  } = {},
): EntitySnapshot {
  const id = o.id ?? 7557;
  return {
    entity: {
      type: o.entityType ?? "Shot",
      id,
      name: `sh${id}`,
      entityType: o.entityType ?? "Shot",
      taskTemplate: o.taskTemplate
        ? { type: "TaskTemplate", id: o.taskTemplate }
        : null,
    },
    tasks: tasks.map((t) => ({
      ...t,
      entity: { type: o.entityType ?? "Shot", id },
    })),
    edges: o.edges ?? [],
    usage: o.usage ?? {},
    readAt: "2026-09-24T10:00:00Z",
  };
}

// shot-before of recipe 015: roto@CharFX -> tt1 roto, comp@Animation -> tt1 comp, paint@FX hand-made, ip.
const before = () => [
  task(47295, "roto", 12, { link: 47102, linkTemplate: 201 }),
  task(47296, "comp", 11, { link: 47101, linkTemplate: 201 }),
  task(47297, "paint", 14, { status: "ip", createdAt: "2026-09-02T16:01:53Z" }),
];

const kinds = (p: ReturnType<typeof planEntity>) => p.rows.map((r) => r.kind);
const rowFor = (p: ReturnType<typeof planEntity>, taskId: Id) =>
  p.rows.find(
    (r) => r.kind !== "create" && r.kind !== "conflict" && r.task.id === taskId,
  )!;

describe("planEntity: rows", () => {
  it("plans recipe 015: claims comp and paint, creates roto at Comp, leaves roto at Character FX", () => {
    const p = planEntity(tt2, snap(before(), { taskTemplate: 201 }), ctx, opts);
    expect(p.counts).toEqual({
      keep: 0,
      claim: 2,
      create: 1,
      extra: 1,
      conflict: 0,
    });
    expect(kinds(p)).toEqual(["claim", "create", "claim", "extra"]);
    const comp = rowFor(p, 47296);
    expect(comp).toMatchObject({
      kind: "claim",
      previousTemplateTask: { id: 47101, templateId: 201 },
    });
    expect(rowFor(p, 47295)).toMatchObject({
      kind: "extra",
      action: "leave",
      reason: "not_in_template",
    });
    expect(p.needsClearFirst).toBe(false);
    expect(p.noop).toBe(false);
  });

  it("plans keep for a task already linked to the template task", () => {
    const p = planEntity(
      tt2,
      snap([task(1, "comp", 11, { link: 47201, linkTemplate: 202 })]),
      ctx,
      opts,
    );
    expect(rowFor(p, 1)).toMatchObject({
      kind: "keep",
      keyMismatch: false,
      rename: null,
    });
  });

  it("plans create with the template dates copied", () => {
    const p = planEntity(tt2, snap([]), ctx, opts);
    const roto = p.rows.find(
      (r) => r.kind === "create" && r.templateTask.id === 47202,
    );
    expect(roto).toMatchObject({
      templateDates: { start: "2026-03-02", due: "2026-03-04" },
    });
  });

  it("offers clearing dates only on a created task with no upstream (097)", () => {
    const p = planEntity(tt2, snap([]), ctx, opts);
    const clearable = Object.fromEntries(
      p.rows.flatMap((r) =>
        r.kind === "create" ? [[r.templateTask.id, r.datesClearable]] : [],
      ),
    );
    // comp is downstream of paint in tt2; roto and paint have no upstream.
    expect(clearable).toEqual({ 47201: false, 47202: true, 47203: true });
  });

  it("fixture 084: switching tt1 to tt2 yields no duplicate", () => {
    const tasks = [
      task(1, "comp", 11, { link: 47101, linkTemplate: 201 }),
      task(2, "roto", 12, { link: 47102, linkTemplate: 201 }),
    ];
    const p = planEntity(tt2, snap(tasks, { taskTemplate: 201 }), ctx, opts);
    expect(p.counts).toEqual({
      keep: 0,
      claim: 1,
      create: 2,
      extra: 1,
      conflict: 0,
    });
    expect(
      p.rows
        .filter((r) => r.kind === "create")
        .map((r) => r.kind === "create" && r.templateTask.id),
    ).toEqual([47202, 47203]);
  });

  it("counts match rows", () => {
    const p = planEntity(
      tt2,
      snap([...before(), task(9, "paint", 14)]),
      ctx,
      opts,
    );
    for (const k of ["keep", "claim", "create", "extra", "conflict"] as const) {
      expect(p.counts[k]).toBe(p.rows.filter((r) => r.kind === k).length);
    }
  });
});

describe("planEntity: conflicts", () => {
  const tasks = () => [
    ...before(),
    task(47299, "Paint ", 14, { createdAt: "2026-09-03T09:00:00Z" }),
  ];
  const usage = { 47299: { versions: 1, publishedFiles: 0 } };

  it("shows the conflict and resolves it to the pre-pick, the other an extra conflict_loser", () => {
    const p = planEntity(tt2, snap(tasks(), { usage }), ctx, opts);
    expect(p.counts).toEqual({
      keep: 0,
      claim: 2,
      create: 1,
      extra: 2,
      conflict: 1,
    });
    const c = p.rows.find((r) => r.kind === "conflict")!;
    expect(c).toMatchObject({
      pick: { 47203: 47299 },
      prePick: { 47203: 47299 },
      reason: "usage",
    });
    expect(
      c.kind === "conflict" && c.candidates.map((x) => [x.task.id, x.usage]),
    ).toEqual([
      [47299, { versions: 1, publishedFiles: 0 }],
      [47297, { versions: 0, publishedFiles: 0 }],
    ]);
    expect(rowFor(p, 47299)).toMatchObject({ kind: "claim" });
    expect(rowFor(p, 47297)).toMatchObject({
      kind: "extra",
      reason: "conflict_loser",
      action: "leave",
    });
  });

  it("a user pick overrides the pre-pick", () => {
    const p = planEntity(
      tt2,
      snap(tasks(), { usage }),
      ctx,
      withConflictPick(opts, 47203, 47297),
    );
    expect(rowFor(p, 47297)).toMatchObject({ kind: "claim" });
    expect(rowFor(p, 47299)).toMatchObject({
      kind: "extra",
      reason: "conflict_loser",
    });
  });

  it("a null pick creates and makes every candidate an extra", () => {
    const p = planEntity(
      tt2,
      snap(tasks(), { usage }),
      ctx,
      withConflictPick(opts, 47203, null),
    );
    expect(
      p.rows.some((r) => r.kind === "create" && r.templateTask.id === 47203),
    ).toBe(true);
    expect(rowFor(p, 47297).kind).toBe("extra");
    expect(rowFor(p, 47299).kind).toBe("extra");
  });

  it("a per-entity pick applies to that entity only: template task ids repeat across entities", () => {
    const o = withEntityConflictPick(opts, 7557, 47203, 47297);
    expect(o.entityConflictPicks).toEqual({ 7557: { 47203: 47297 } });
    const mine = planEntity(tt2, snap(tasks(), { usage }), ctx, o);
    expect(rowFor(mine, 47297)).toMatchObject({ kind: "claim" });
    expect(mine.warnings.some((w) => w.code === "unresolved_conflict")).toBe(false);
    // Another entity with the same template task: untouched by it, no warning either.
    const other = planEntity(tt2, snap(tasks(), { usage, id: 9000 }), ctx, o);
    expect(rowFor(other, 47299)).toMatchObject({ kind: "claim" });
    expect(other.warnings.some((w) => w.code === "unresolved_conflict")).toBe(false);
  });

  it("a per-entity pick wins over a run-wide one", () => {
    const o = withEntityConflictPick(withConflictPick(opts, 47203, null), 7557, 47203, 47297);
    expect(rowFor(planEntity(tt2, snap(tasks(), { usage }), ctx, o), 47297)).toMatchObject({ kind: "claim" });
  });

  it("warns and falls back to the pre-pick on a pick that is not a candidate", () => {
    const p = planEntity(
      tt2,
      snap(tasks(), { usage }),
      ctx,
      withConflictPick(opts, 47203, 12345),
    );
    expect(rowFor(p, 47299).kind).toBe("claim");
    expect(p.warnings).toContainEqual({
      code: "unresolved_conflict",
      templateTaskIds: [47203],
    });
  });

  it("resolves a pick of a task linked to the template task to keep", () => {
    const linked = [
      task(1, "paint", 14, {
        link: 47203,
        linkTemplate: 202,
        createdAt: "2026-02-01T00:00:00Z",
      }),
      task(2, "paint", 14, {
        link: 47203,
        linkTemplate: 202,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ];
    const p = planEntity(tt2, snap(linked), ctx, opts);
    expect(rowFor(p, 2).kind).toBe("keep");
    expect(rowFor(p, 1)).toMatchObject({
      kind: "extra",
      reason: "conflict_loser",
    });
  });

  it("shows re-sync field changes on a loser still linked to the template (102)", () => {
    const tpl: Template = {
      ...tt2,
      tasks: [tt(47203, "paint", 14, 30, { fields: { sg_description: "T" } })],
    };
    const linked = [
      task(1, "paint", 14, {
        link: 47203,
        linkTemplate: 202,
        createdAt: "2026-02-01T00:00:00Z",
      }),
      task(2, "paint", 14, {
        link: 47203,
        linkTemplate: 202,
        createdAt: "2026-01-01T00:00:00Z",
      }),
    ];
    const p = planEntity(tpl, snap(linked), ctx, opts);
    const loser = rowFor(p, 1);
    expect(
      loser.kind === "extra" && loser.fieldChanges?.map((c) => c.field),
    ).toEqual(["sg_description"]);
  });

  it("warns on a template with two tasks of one key and gives the task to the first (Q-E)", () => {
    const tpl: Template = {
      ...tt2,
      tasks: [tt(11, "Comp", 13, 10), tt(10, "comp", 13, 20)],
      edges: [],
    };
    const p = planEntity(tpl, snap([task(1, "comp", 13)]), ctx, opts);
    expect(p.warnings).toContainEqual({
      code: "template_duplicate_key",
      key: matchKey("comp", 13),
      templateTaskIds: [11, 10],
    });
    expect(rowFor(p, 1).kind).toBe("claim");
    expect(
      p.rows.some((r) => r.kind === "create" && r.templateTask.id === 10),
    ).toBe(true);
  });
});

describe("planEntity: extras", () => {
  const tasks = () => [
    task(1, "Cleanup", 14),
    task(2, "cleanup ", 13),
    task(3, "lookdev", 14),
  ];

  it("falls back override, then by name, then leave", () => {
    const o = withExtraOverride(
      withExtraByName(opts, " CleanUp", "omit"),
      2,
      "delete",
    );
    const p = planEntity(tt2, snap(tasks()), ctx, o);
    expect(rowFor(p, 1)).toMatchObject({ action: "omit" });
    expect(rowFor(p, 2)).toMatchObject({ action: "delete" });
    expect(rowFor(p, 3)).toMatchObject({ action: "leave" });
  });

  it("warns on a delete with versions or published files, with the counts (089)", () => {
    const usage = { 1: { versions: 2, publishedFiles: 1 } };
    const p = planEntity(
      tt2,
      snap(tasks(), { usage }),
      ctx,
      withExtraByName(opts, "cleanup", "delete"),
    );
    expect(p.warnings).toContainEqual({
      code: "delete_with_usage",
      taskId: 1,
      usage: { versions: 2, publishedFiles: 1 },
    });
    expect(
      p.warnings.filter((w) => w.code === "delete_with_usage"),
    ).toHaveLength(1);
    expect(rowFor(p, 1)).toMatchObject({
      usage: { versions: 2, publishedFiles: 1 },
    });
  });

  it("does not warn on a delete without usage or on an omit with usage", () => {
    const usage = { 1: { versions: 2, publishedFiles: 0 } };
    const p = planEntity(
      tt2,
      snap(tasks(), { usage }),
      ctx,
      withExtraByName(opts, "cleanup", "omit"),
    );
    expect(p.warnings.some((w) => w.code === "delete_with_usage")).toBe(false);
  });
});

describe("fieldChanges", () => {
  const tplTask = tt(47203, "paint", 14, 30, {
    fields: {
      sg_description: "T desc",
      est_in_mins: 600,
      sg_priority_1: "1_Tier",
      task_reviewers: [],
      milestone: true,
    },
  });

  it("lists every field whose non-empty template value differs, custom fields included (102)", () => {
    const t = task(1, "paint", 14, {
      fields: {
        sg_description: "hand",
        est_in_mins: 600,
        sg_priority_1: null,
        milestone: false,
      },
    });
    const c = fieldChanges(t, tplTask, {});
    expect(c.map((x) => x.field)).toEqual([
      "sg_description",
      "sg_priority_1",
      "milestone",
    ]);
  });

  it("defaults to keep: the result is the current value", () => {
    const t = task(1, "paint", 14, { fields: { sg_description: "hand" } });
    expect(fieldChanges(t, tplTask, {})).toContainEqual({
      field: "sg_description",
      current: "hand",
      template: "T desc",
      policy: "keep",
      result: "hand",
    });
  });

  it("overwrite takes the template value", () => {
    const t = task(1, "paint", 14, { fields: { sg_description: "hand" } });
    const c = fieldChanges(t, tplTask, { sg_description: "overwrite" });
    expect(c.find((x) => x.field === "sg_description")).toMatchObject({
      policy: "overwrite",
      result: "T desc",
    });
  });

  it("fill_if_empty fills null and empty string, keeps a set value", () => {
    const pol = {
      sg_description: "fill_if_empty",
      sg_priority_1: "fill_if_empty",
    } as const;
    const t = task(1, "paint", 14, {
      fields: { sg_description: "", sg_priority_1: "3_Tier" },
    });
    const c = fieldChanges(t, tplTask, pol);
    expect(c.find((x) => x.field === "sg_description")?.result).toBe("T desc");
    expect(c.find((x) => x.field === "sg_priority_1")?.result).toBe("3_Tier");
    const u = fieldChanges(
      task(2, "paint", 14, { fields: { sg_priority_1: null } }),
      tplTask,
      pol,
    );
    expect(u.find((x) => x.field === "sg_priority_1")?.result).toBe("1_Tier");
  });

  it("does not offer fill_if_empty on a boolean: falls back to keep (Q-F)", () => {
    const t = task(1, "paint", 14, { fields: { milestone: false } });
    const c = fieldChanges(t, tplTask, { milestone: "fill_if_empty" });
    expect(c.find((x) => x.field === "milestone")).toMatchObject({
      policy: "keep",
      result: false,
    });
  });

  it("skips empty template values: an empty template field never clears (102)", () => {
    const t = task(1, "paint", 14, {
      fields: { task_reviewers: [{ type: "Group", id: 2 }] },
    });
    expect(
      fieldChanges(t, tplTask, { task_reviewers: "overwrite" }).map(
        (x) => x.field,
      ),
    ).not.toContain("task_reviewers");
  });

  it("compares entity links by type and id, lists as sets", () => {
    const tpl = tt(5, "paint", 14, 30, {
      fields: {
        task_reviewers: [
          { type: "Group", id: 1, name: "G1" },
          { type: "HumanUser", id: 3 },
        ],
      },
    });
    const same = task(1, "paint", 14, {
      fields: {
        task_reviewers: [
          { type: "HumanUser", id: 3, name: "x" },
          { type: "Group", id: 1 },
        ],
      },
    });
    expect(fieldChanges(same, tpl, {})).toEqual([]);
  });

  it("never puts status, dates or assignees under policy", () => {
    const tpl = tt(5, "paint", 14, 30, {
      fields: {
        sg_status_list: "fin",
        start_date: "2026-01-01",
        due_date: "2026-01-02",
        task_assignees: [{ type: "Group", id: 1 }],
      },
    });
    expect(fieldChanges(task(1, "paint", 14), tpl, {})).toEqual([]);
  });

  it("puts duration under policy only on a task without dates (102)", () => {
    const tpl = tt(5, "paint", 14, 30, { fields: { duration: 960 } });
    const undated = task(1, "paint", 14, { fields: { duration: 1920 } });
    const dated = task(2, "paint", 14, {
      fields: { duration: 2400 },
      start: "2026-05-04",
      due: "2026-05-08",
    });
    expect(fieldChanges(undated, tpl, {}).map((x) => x.field)).toEqual([
      "duration",
    ]);
    expect(fieldChanges(dated, tpl, {})).toEqual([]);
  });

  it("leaves duration alone on a task with only one date (108)", () => {
    const tpl = tt(5, "paint", 14, 30, { fields: { duration: 960 } });
    const startOnly = task(1, "paint", 14, {
      fields: { duration: 1920 },
      start: "2026-05-04",
    });
    const dueOnly = task(2, "paint", 14, {
      fields: { duration: 1920 },
      due: "2026-05-08",
    });
    expect(fieldChanges(startOnly, tpl, {})).toEqual([]);
    expect(fieldChanges(dueOnly, tpl, {})).toEqual([]);
  });

  it("defaults content to overwrite and step to keep", () => {
    const tpl = tt(5, "paint", 14, 30);
    const t = task(1, "Paint v2", 12);
    const c = fieldChanges(t, tpl, {});
    expect(c.find((x) => x.field === "content")).toMatchObject({
      policy: "overwrite",
      result: "paint",
    });
    expect(c.find((x) => x.field === "step")).toMatchObject({
      policy: "keep",
      result: step(12),
    });
  });
});

describe("planEntity: field changes and renames", () => {
  it("flags a rename of a hand-renamed linked task loudly", () => {
    const p = planEntity(
      tt2,
      snap([task(1, "Comp v2", 11, { link: 47201, linkTemplate: 202 })]),
      ctx,
      opts,
    );
    expect(rowFor(p, 1)).toMatchObject({
      kind: "keep",
      keyMismatch: true,
      rename: { from: "Comp v2", to: "comp", handRenamed: true },
    });
    expect(p.warnings).toContainEqual({
      code: "rename",
      taskId: 1,
      from: "Comp v2",
      to: "comp",
      handRenamed: true,
    });
  });

  it("flags a case-only rename of a claim, not loud", () => {
    const p = planEntity(tt2, snap([task(1, "Comp ", 11)]), ctx, opts);
    expect(rowFor(p, 1)).toMatchObject({
      kind: "claim",
      rename: { from: "Comp ", to: "comp", handRenamed: false },
    });
  });

  it("does not rename under content keep", () => {
    const o = withFieldPolicy(opts, "content", "keep");
    const p = planEntity(
      tt2,
      snap([task(1, "Comp v2", 11, { link: 47201, linkTemplate: 202 })]),
      ctx,
      o,
    );
    expect(rowFor(p, 1)).toMatchObject({ rename: null });
    expect(p.warnings.some((w) => w.code === "rename")).toBe(false);
  });

  it("never plans field changes on create or plain extra rows", () => {
    const tpl: Template = {
      ...tt2,
      tasks: [tt(47201, "comp", 11, 10, { fields: { sg_description: "T" } })],
    };
    const p = planEntity(tpl, snap([task(1, "lookdev", 11)]), ctx, opts);
    for (const r of p.rows)
      expect("fieldChanges" in r && r.fieldChanges?.length).toBeFalsy();
  });
});

describe("planEntity: entity level", () => {
  const linked = () => [
    task(1, "comp", 11, { link: 47201, linkTemplate: 202 }),
    task(2, "roto", 13, { link: 47202, linkTemplate: 202 }),
    task(3, "paint", 14, { link: 47203, linkTemplate: 202 }),
  ];
  // tt2's edge on the linked Tasks: comp on paint, start-to-start 1.
  const tplEdge: Edge = {
    id: 77,
    downstream: 1,
    upstream: 3,
    type: "start-to-start",
    offsetDays: 1,
  };
  const applied = (extra: Partial<Parameters<typeof snap>[1]> = {}) =>
    snap(linked(), { taskTemplate: 202, edges: [tplEdge], ...extra });

  it("needsClearFirst when task_template already equals the template", () => {
    expect(
      planEntity(tt2, snap(linked(), { taskTemplate: 202 }), ctx, opts)
        .needsClearFirst,
    ).toBe(true);
    expect(
      planEntity(tt2, snap(linked(), { taskTemplate: 201 }), ctx, opts)
        .needsClearFirst,
    ).toBe(false);
    expect(planEntity(tt2, snap(linked()), ctx, opts).needsClearFirst).toBe(
      false,
    );
  });

  it("noop when everything is kept, nothing written and task_template already equals the template", () => {
    expect(planEntity(tt2, applied(), ctx, opts).noop).toBe(true);
    expect(
      planEntity(tt2, applied({ taskTemplate: 201 }), ctx, opts).noop,
    ).toBe(false);
  });

  it("noop survives a kept hand edit, not an overwrite", () => {
    const tpl: Template = {
      ...tt2,
      tasks: tt2.tasks.map((t) => ({
        ...t,
        fields: { ...t.fields, sg_description: "T" },
      })),
    };
    const s = applied();
    expect(planEntity(tpl, s, ctx, opts).noop).toBe(true);
    expect(
      planEntity(
        tpl,
        s,
        ctx,
        withFieldPolicy(opts, "sg_description", "overwrite"),
      ).noop,
    ).toBe(false);
  });

  it("is not noop with an omitted extra, nor with a confirmed delete", () => {
    const s = snap([...linked(), task(9, "x", 11)], {
      taskTemplate: 202,
      edges: [tplEdge],
    });
    expect(planEntity(tt2, s, ctx, opts).noop).toBe(true);
    expect(
      planEntity(tt2, s, ctx, withExtraOverride(opts, 9, "omit")).noop,
    ).toBe(false);
    const del = withExtraOverride(opts, 9, "delete");
    expect(planEntity(tt2, s, ctx, del).noop).toBe(true); // blocked until confirmed
    expect(
      planEntity(tt2, s, ctx, { ...del, deleteConfirmed: true }).noop,
    ).toBe(false);
  });

  it("warns on template entity_type mismatch (083)", () => {
    const p = planEntity(tt2, snap([], { entityType: "Asset" }), ctx, opts);
    expect(p.warnings).toContainEqual({
      code: "template_entity_type_mismatch",
      templateType: "Shot",
      entityType: "Asset",
    });
    expect(
      planEntity(tt2, snap([]), ctx, opts).warnings.some(
        (w) => w.code === "template_entity_type_mismatch",
      ),
    ).toBe(false);
  });

  it("plans edges through edges.ts: a missing template edge breaks noop", () => {
    const p = planEntity(tt2, applied({ edges: [] }), ctx, opts);
    expect(p.edges.expectedAdded).toEqual([
      {
        templateEdge: tt2.edges[0],
        downstream: { existing: 1 },
        upstream: { existing: 3 },
      },
    ]);
    expect(p.noop).toBe(false);
    expect(isNoop(planEntity(tt2, applied(), ctx, opts))).toBe(true);
  });

  it("maps a created task into the edge plan", () => {
    const p = planEntity(tt2, snap([task(3, "paint", 14)]), ctx, opts);
    expect(p.edges.expectedAdded).toEqual([
      {
        templateEdge: tt2.edges[0],
        downstream: { created: 47201 },
        upstream: { existing: 3 },
      },
    ]);
  });

  it("an edge the user removes breaks noop, a kept one does not", () => {
    const stray: Edge = {
      id: 5,
      downstream: 2,
      upstream: 1,
      type: "start-to-start",
      offsetDays: 0,
    };
    const s = applied({ edges: [tplEdge, stray] });
    const keep = planEntity(tt2, s, ctx, opts);
    expect(keep.edges.affected).toMatchObject([
      { existing: { id: 5 }, cause: "not_in_template", action: "keep" },
    ]);
    expect(keep.noop).toBe(true);
    expect(
      planEntity(tt2, s, ctx, { ...opts, edgeActions: { 5: "remove" } }).noop,
    ).toBe(false);
  });

  it("warns on a kept edge that would close a loop, removed by default (085, 107)", () => {
    // tt2 adds comp(1) on paint(3). Site: roto(2) on comp(1), paint(3) on roto(2): 3 -> 1 -> 2 -> 3.
    const a: Edge = { id: 6, downstream: 2, upstream: 1, type: "finish-to-start-next-day", offsetDays: null };
    const b: Edge = { id: 7, downstream: 3, upstream: 2, type: "finish-to-start-next-day", offsetDays: null };
    const p = planEntity(tt2, snap(linked(), { edges: [a, b] }), ctx, opts);
    expect(p.edges.affected).toMatchObject([
      { existing: { id: 6 }, action: "keep" },
      { existing: { id: 7 }, closesLoop: true, action: "remove" },
    ]);
    expect(p.warnings).toContainEqual({ code: "edge_closes_loop", edgeId: 7, action: "remove" });
    expect(p.warnings.filter((w) => w.code === "edge_closes_loop")).toHaveLength(1);
  });
});

describe("planRun and bulk helpers", () => {
  const s1 = snap([task(1, "Cleanup", 14), task(2, "comp", 11)], { id: 1 });
  const s2 = snap([task(3, "cleanup", 11), task(4, "lookdev", 11)], { id: 2 });

  it("plans every entity", () => {
    const plans = planRun(tt2, [s1, s2], ctx, opts);
    expect(plans.map((p) => p.entity.id)).toEqual([1, 2]);
  });

  it("bulk extra by name matches normalized content across entities", () => {
    const plans = planRun(
      tt2,
      [s1, s2],
      ctx,
      withExtraByName(opts, "CLEANUP ", "omit"),
    );
    expect(rowFor(plans[0], 1)).toMatchObject({ action: "omit" });
    expect(rowFor(plans[1], 3)).toMatchObject({ action: "omit" });
    expect(rowFor(plans[1], 4)).toMatchObject({ action: "leave" });
  });

  it("lists extra names across entities with counts, for the bulk setter", () => {
    expect(extraNames(planRun(tt2, [s1, s2], ctx, opts))).toEqual([
      { name: "cleanup", count: 2 },
      { name: "lookdev", count: 1 },
    ]);
  });

  it("bulk helpers return new options and leave the input alone", () => {
    const o = withFieldPolicy(
      withExtraByName(opts, "x", "delete"),
      "sg_description",
      "overwrite",
    );
    expect(o.extraByName).toEqual({ x: "delete" });
    expect(o.fieldPolicies).toEqual({ sg_description: "overwrite" });
    expect(opts.extraByName).toEqual({});
    expect(opts.fieldPolicies).toEqual({});
  });

  it("lists the fields under policy: non-empty on some template task, content first", () => {
    const tpl: Template = {
      ...tt2,
      tasks: [
        tt(1, "a", 11, 10, {
          fields: {
            sg_description: "x",
            sg_priority_1: null,
            duration: 60,
            sg_status_list: "wtg",
          },
        }),
        tt(2, "b", null, 20, {
          fields: { sg_priority_1: "1_Tier", milestone: false },
        }),
      ],
    };
    expect(fieldsUnderPolicy(tpl)).toEqual([
      "content",
      "step",
      "sg_description",
      "duration",
      "sg_priority_1",
    ]);
  });
});

describe("entry filters", () => {
  const ents = [
    { type: "Shot", id: 1, taskTemplate: { type: "TaskTemplate", id: 202 } },
    { type: "Shot", id: 2, taskTemplate: null },
    { type: "Shot", id: 3, taskTemplate: { type: "TaskTemplate", id: 201 } },
  ];

  it("entities using a template", () => {
    expect(entitiesUsingTemplate(ents, 202).map((e) => e.id)).toEqual([1]);
  });

  it("entities with no template", () => {
    expect(entitiesWithoutTemplate(ents).map((e) => e.id)).toEqual([2]);
  });

  it("reads the project default template id for a type (088)", () => {
    const ts = {
      default_task_template: {
        Asset: { type: "TaskTemplate", id: 40, name: "t", valid: "valid" },
      },
    };
    expect(defaultTemplateId(ts, "Asset")).toBe(40);
    expect(defaultTemplateId(ts, "Shot")).toBeNull();
    expect(
      defaultTemplateId({ default_task_template: {} }, "Asset"),
    ).toBeNull();
    expect(defaultTemplateId({}, "Asset")).toBeNull();
    expect(defaultTemplateId(null, "Asset")).toBeNull();
  });
});
