# sg-task-templates

Apply a task template to Shots and Assets that already have Tasks, and merge instead of duplicating: a
Task with the template task's name and step is kept, with its status, assignees and publishes; only
what is missing is created; nothing is deleted unless asked, and never silently. Every change is shown
per entity before it is written. Built on `../sg-widgets`, public on GitHub, a Svelte app like sg-notes.

Status, 2026-09-24: grilling done. Corpus probes are on probe branches under sg-groundtruth
[#79](https://github.com/ksallee/sg-groundtruth/issues/79), merge
[PR #80](https://github.com/ksallee/sg-groundtruth/pull/80) open. Client gaps: sg-widgets
[PR #331](https://github.com/ksallee/sg-widgets/pull/331) open. Repo created
([#1](https://github.com/ksallee/sg-task-templates/issues/1),
[PR #2](https://github.com/ksallee/sg-task-templates/pull/2)). Deploy at the end, to
`sg-task-templates.vercel.app`.

## Why

- The built-in dialog matches Tasks by their hidden `template_task` link, never by name and step.
  Switching a Shot from one template to an overlapping one flags every Task: delete them (publishes
  orphaned, path caches broken) or keep them (duplicates). Forum
  [20654](https://community.shotgridsoftware.com/t/20654), Feb 2026, still getting "same here" on
  2026-09-24; two studios say they wrote their own tool for exactly this.
- "Reapply to project" overwrites duration and other fields; people ask to choose per field
  ([3237](https://community.shotgridsoftware.com/t/3237), 5,163 views, 39 likes).
- Pushing changed dependencies onto 14,000 existing Tasks without losing statuses has no answer but a
  CSV round trip ([18613](https://community.shotgridsoftware.com/t/18613)).
- The importer, Import Cut and API create ignore the project's default template
  ([576](https://community.shotgridsoftware.com/t/576), [20648](https://community.shotgridsoftware.com/t/20648)).
- No merge option shipped up to 8.89 (Aug 2026). No open-source tool does this.

Full evidence and the other app ideas: `~/Desktop/SG APPS.md`, raw threads in
`~/Desktop/SG APPS research/`.

## What the API does (read before deciding anything)

From sg-groundtruth, tag `corpus/2026-09-24`. Read `corpus/INDEX.md` first, then these.

| entry | rule the app rests on |
|---|---|
| `findings/entity_types/TaskTemplate.md` | A template's Tasks are Task rows with `task_template` set and `project` null. Deleting a template deletes its Tasks. The template's `entity_type` is not enforced. |
| `findings/083_task_template_on_create` | Creating an entity with `task_template` makes the Tasks in the same call: step, status, sort order, duration, estimate, description, milestone, assignees, dependencies with type and offset. Dates copy as the same calendar dates. |
| `findings/084_task_template_reapply` | Writing `task_template` only adds: one Task per template task no Task points at through `template_task`. Never removes, never merges by name. Runs only when the value changes. No mode. Corrected by 096 and 102 below: the apply also re-syncs fields and edges on every Task already linked to the template, not only new Tasks. |
| `recipes/015_apply_task_template_without_duplicates` | The merge: point each same-name, same-step Task's `template_task` at its template task in one batch, then clear and set `task_template`. The server creates only what is missing, and copies dependencies onto claimed Tasks too. Corrected by 096 and 102 below: the final `task_template` write also re-syncs fields and edges on every linked Task, not only newly claimed ones. |
| `findings/085_task_dependency_types`, `recipes/016_create_tasks_with_dependencies` | Four dependency types; `offset_days` in working days, may be negative; `task` is the downstream Task, `dependent_task` the upstream one. |
| `findings/086_batch_tasks_with_dependencies` | One `_batch` cannot link rows it creates. |
| `findings/087_dependency_cascade` | Unpinned downstream Tasks move with their upstream; pinned ones stay and flag `dependency_violation`. Writing a Task's own dates pins it; corrected by 093: only a `start_date` write does. |
| `findings/088_project_template_defaults` | The default per entity type is `Project.tracking_settings.default_task_template.<Type>`. Whether API create applies it is unmeasured. |
| `findings/089_task_delete_side_effects` | Deleting a Task orphans `Version.sg_task` and `PublishedFile.task` and cuts the dependency chain. Revive restores all of it. |
| `findings/090_template_task_events` | Every apply is in the event log under the writer; filter on `attribute_name` `template_task`. |
| `recipes/002_batch`, `reports/001` | A batch is atomic and ordered; a create inside a batch skips validation. |
| `findings/052`, `recipes/012` | Sign in as a person with the App Session Launcher. |
| `probe/79-092` (probe branch, #79, not yet on dev) | An added dependency edge (direct, or the apply's copy on claim) reschedules unpinned downstream Tasks at once; a pinned one holds and flags `dependency_violation`. The claim alone moves nothing. |
| `probe/79-093` (probe branch, #79, not yet on dev) | On a dependent Task, a `start_date` write pins it, null or a real date. A `due_date` write never pins; it recomputes `duration`. `pinned: false` recomputes both dates from upstream. |
| `probe/79-095` (probe branch, #79, not yet on dev) | Remove an edge with `DELETE /entity/task_dependencies/<id>`, never through `upstream_tasks`/`downstream_tasks` (erases it, no revive). Undo revives the same id, type and offset; dates recompute from upstream, not restored. Reviving after the same pair is re-created is a 400. |
| `probe/79-096` (probe branch, #79, not yet on dev) | Writing `task_template` re-syncs fields and edges on Tasks already linked to it (full list at 102). Corrects 084 and recipe 015. |
| `probe/79-097` (probe branch, #79, not yet on dev) | A Task with no upstream edge never pins. Cleared dates stay null. |
| `probe/79-098` (probe branch, #79, not yet on dev) | One `_batch` (claim, `task_template` null, `task_template` T) sees each request's earlier writes and gives the same result as separate calls: one batch per entity, write-backs included. |
| `recipes/020_apply_task_template_in_one_batch` (sg-groundtruth PR #80) | Recipe 015 as one `_batch` per entity: claims, `task_template` null, `task_template` T, then the write-backs (098). |
| `probe/79-099` (probe branch, #79, not yet on dev) | Every `task_template` write reconciles all template edges against `template_task` links: kept+claimed, kept+kept and kept+created pairs all get the missing edge. |
| `probe/79-100` (probe branch, #79, not yet on dev) | Writing `duration` on a dependent Task does not pin it; it recomputes dates from upstream and cascades downstream. |
| `probe/79-101` (probe branch, #79, not yet on dev) | On apply, a template edge replaces an existing edge of another type or the reverse edge; the old edge is erased, not revivable, so undo must re-create it from the recorded type and offset. Edges to Tasks outside the template are kept. |
| `probe/79-102` (probe branch, #79, not yet on dev) | Writing `task_template`=T re-syncs every Task linked to T, claimed-this-run included. Fields: the list under Decided 4 below. Edges between T-linked Tasks: missing template edge added, other type or offset replaced by T's, non-template edge deleted. Edges to other Tasks kept. Writing `null` or another template touches no T-linked Task. Corrects 084 and recipe 015. |
| `probe/79-094` (probe branch, #79, not yet on dev) | Access pre-check that writes nothing. `GET /schema/<Type>/fields?project_id=` gives `editable` per field: `false` is a refusal, `true` only maybe. Then three writes the server refuses before landing: a no-op PUT, a create with a bad `sg_status_list`, a `_batch` [delete, update of a missing id]. Recipe `017_check_permission_before_writing`. Partial: measured via `sudo_as`. |

## Decided

- **Web, SvelteKit at the repo root**, one process, deployed on Vercel from `main`, like sg-notes.
  Public repo `ksallee/sg-task-templates`, MIT.
- **Sign-in as a person** through the App Session Launcher, token in the browser, no script key, no
  server holding secrets. Writes land in the event log under the person.
- **The merge is recipe 015.** The app never re-implements what the server's apply already does
  (copying fields and dependencies onto new Tasks).
- **Preview before write, always.** Nothing is written from a screen that has not shown the plan.
- **Live only, no mock**, as sg-notes. A dev-only token route for headless drives.
- **Widgets are registry copies** from sg-widgets. What the client lacks grows in sg-widgets, issue and
  PR there, never a private extension here: `delete` and `batch` are missing today.
- **No LLM in the app.** Deterministic. Nothing that looks like configurable automations or an agent
  writing app config (flowpilot overlap, see `~/Desktop/SG APPS.md`).

## Decided in the grilling session (2026-09-24)

1. **Scope of a run**
   - One project per run.
   - Every entity type with a `task_template` field, read from the schema, custom entities included.
   - Two entry points, one planner: pick entities then a template (20654), or pick a template then
     "every entity using it" (18613).
2. **Matching**
   - Key: `content` trimmed, casefolded, inner whitespace runs collapsed to one space, plus step id.
     The plan shows the normalized match (Kevin, 2026-09-24).
   - A Task linked to another template's task with the same key is claimed. The plan shows the old
     link and the undo record keeps it.
   - Two Tasks on one entity with the same key: a conflict the user resolves, with a pre-pick: the one
     with Versions or PublishedFiles, then a status other than the default, then the oldest. Except: if
     one of the two is already linked to this template's task, the link wins outright, no conflict; the
     other same-key Task is an extra, left by default (Kevin, 2026-09-24).
   - The template itself with two tasks of one key: a conflict the user resolves in the plan, not
     first-by-sort-order (Kevin, 2026-09-24).
3. **Extras** (Tasks on the entity that the template lacks)
   - Listed under each entity. One action each: **leave** (default), **omit** (status) or **delete**.
     Bulk-set by name.
   - Delete asks for a second confirmation. A Task with Versions or PublishedFiles linked can be
     deleted, with a loud warning that shows the counts (089). Undo revives it.
   - An edge between an extra and a claimed/kept Task: listed for information, never removed; the apply
     keeps it (Kevin, 2026-09-24; probe 101).
4. **Kept and claimed Tasks**
   - What the apply does to linked Tasks (probe 102). Overwritten when the template's value is
     non-empty: `content`, `step`, `est_in_mins`, `sg_description`, `sg_sort_order`,
     `task_reviewers`, `milestone`, custom fields (seen: `sg_priority_1`); `duration` only on a Task
     with no dates. Kept: `sg_status_list`. `start_date`/`due_date` kept when set, filled then
     cascaded when empty. Filled only if empty: `task_assignees`. An empty template value never
     clears a field.
   - Per-field policy, per run, over every overwritten field above, custom fields included: keep
     (default) / overwrite / fill if empty where that makes sense. Keep = read the field before the
     apply, write it back after, in the same batch (probe 098). Milestone and other booleans: keep /
     overwrite only (Kevin, 2026-09-24).
   - `content` (the Task's name): default is overwrite, to the template's name; keep on opt-in. The
     plan flags every rename, loudly when a linked Task was renamed by hand (Kevin, 2026-09-24).
   - Dependencies: the apply adds every missing template edge between linked Tasks (kept+kept,
     kept+claimed, kept+created; probe 099). Between linked Tasks it also deletes non-template edges
     and replaces edges of another type, offset or direction (probe 102). The server does this
     regardless. The plan lists each deleted or replaced edge with keep (default) / remove. Keep
     re-creates it after the apply, in the same batch, as a new edge id. That may move dates (probe
     092); the plan shows it (Kevin, 2026-09-24). These edges are erased, not revivable, so a
     re-create (kept, or on undo) uses the recorded type and offset (probes 101, 102).
   - Template dates on created Tasks: shown in the plan, with an opt-in to clear them, offered only on
     Tasks with no upstream edge; those stay unpinned with null dates (Kevin, 2026-09-24; probe 097).
   - Tasks whose dates may move because of new edges are shown. Pinned Tasks are never touched; the
     plan shows those that would flag `dependency_violation`.
5. **Default template**: in v1 as an entry filter. "Entities with no template" in the project, with
   the template pre-selected from `tracking_settings.default_task_template.<Type>` (088). Same apply
   path; nothing relies on the unmeasured API-create behaviour.
6. **Writing**
   - One batch per entity, write-backs included: a `task_template` write sees claims made earlier in
     the same batch, so one `_batch` per entity is enough (changed 2026-09-24, probe 098). A failure
     stops that entity only; the run continues and the result lists failures with a retry.
   - Small concurrency (about 4 entities in flight), async in the browser, with progress.
   - Undo in v1. Per run, per entity as it lands: previous `template_task`, previous values of every
     field under policy, removed or replaced edges, previous status of omitted Tasks, deleted Task ids,
     created Task ids. Revert runs in 096's order: old `template_task` on claimed Tasks, then old
     `task_template` on the entity, then delete created Tasks, then write back pre-merge fields and
     edges; the entity ends back on its old template (Kevin, 2026-09-24). An edge the apply deleted or
     replaced is re-created from its recorded type and offset (probes 101, 102). An edge removed by
     `DELETE` is revived (095). A deleted Task is revived (048).
   - The undo record lives in IndexedDB and downloads as JSON. Undo works from either.
   - A tab closed mid-run: on reopen the unfinished run is offered. Re-plan the remaining entities from
     a fresh read, then continue or undo.
7. **Who uses it**
   - Anyone, writing as themselves. No level gate: permission rules are not readable (027).
   - Before the plan, an access pre-check (recipe `017_check_permission_before_writing`, probe 094):
     `GET /schema/<Type>/fields?project_id=` for `editable`, backed by a no-op PUT, a deliberately bad
     create and a delete run as one `_batch`, all refusable without writing anything. Warns if it looks
     short. Failed writes are reported per entity.
   - A template whose `entity_type` differs from the entity: warning in the plan, allowed.
8. **Output**: the plan as CSV, for review before applying; the result as the undo record JSON.
9. **Views**
   - Screens: connect, template, entities, plan, apply and result.
   - Plan: entity list on the left with five counts, filterable; detail pane on the right with that
     entity's Tasks and actions; bulk actions on top. The counts: **keep**, already linked to this
     template's task; **claim**, same key, link written; **create**, missing, the apply makes it;
     **extra**, on the entity, not in the template; **conflict**, two candidates, the user picks.
   - Default theme only. Light and dark switch in the navbar, following the system preference at
     first. The docs say any sg-widgets theme can be swapped in.
10. **Later, not v1**: combining several templates on one entity; relative offsets and date shift
    (idea E); cross-project runs. No Qt version.

## Corpus gaps

sg-groundtruth [#79](https://github.com/ksallee/sg-groundtruth/issues/79) (probe branches
`probe/79-NNN`, merge PR #80 open): answered: 092, 093, 094, 095, 096, 097, 098, 099, 100, 101, 102.
094 partial: measured via `sudo_as` as an Artist, not a real App Session Launcher session.

## Client gaps (sg-widgets)

sg-widgets [#330](https://github.com/ksallee/sg-widgets/issues/330): `delete`, `revive` (048) and
`batch` on `SgClient`. [PR #331](https://github.com/ksallee/sg-widgets/pull/331), open.

## Next

- Repo created: `ksallee/sg-task-templates`, `dev` and `main`
  ([#1](https://github.com/ksallee/sg-task-templates/issues/1),
  [PR #2](https://github.com/ksallee/sg-task-templates/pull/2)).
- Deploy at the end, once the app works: a Vercel project at `sg-task-templates.vercel.app`, deployed
  from `main`.

## Engineering rules

- Pure functions in their own modules: the planner (template + entity Tasks → plan), matching, the
  batch builder, the result reader. No I/O in them.
- Components only when needed. Pages and views as thin as possible, with as little logic as possible.
- Unit tests for every pure module, written first, fixtures shaped like the corpus responses.
  Integration or E2E tests where a flow needs them (apply against the sandbox project).
- API behaviour comes from the corpus. A gap is a probe in sg-groundtruth first: one issue, a PR to
  `dev`.
- Process as everywhere: issue, branch from `dev`, PR onto `dev`, squash; `main` by a merge-commit PR
  after Kevin QAs.

## Sources

- `../sg-groundtruth`: the corpus. `corpus/INDEX.md` first, then the table above.
- `../sg-notes`: the host pattern to copy. `BRIEF.md`, `docs/development.md` (deploy),
  `src/routes/live/` (the launcher routes and the dev token route), `src/lib/live.ts`,
  `docs/seams.md`.
- `../sg-widgets`: the client and the widgets. Its `CLAUDE.md`; the registry install one-liner.
- `../llm-ui-annotation`: the overlay for annotating the running app in dev, if wanted.
- `~/Desktop/SG APPS.md` and `~/Desktop/SG APPS research/`: the forum evidence.

Clean room: never read `~/dev/fpt-ai`, `~/dev/fpt-api`, `~/dev/flow-data-api-docs`,
`~/dev/flow-data-sdk-python`, `~/dev/tk-*`, `~/dev/flowpilot`. Public shotgunsoftware repos are fine.
