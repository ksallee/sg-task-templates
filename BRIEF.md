# sg-task-templates

Apply a task template to Shots and Assets that already have Tasks, and merge instead of duplicating: a
Task with the template task's name and step is kept, with its status, assignees and publishes; only
what is missing is created; nothing is deleted unless asked, and never silently. Every change is shown
per entity before it is written. Built on `../sg-widgets`, public on GitHub, a Svelte app like sg-notes.

Status, 2026-09-24: grilling done, decisions below. Next: the corpus probes, the client gaps, then the
work.

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
| `findings/084_task_template_reapply` | Writing `task_template` only adds: one Task per template task no Task points at through `template_task`. Never removes, never merges by name. Runs only when the value changes. No mode. |
| `recipes/015_apply_task_template_without_duplicates` | The merge: point each same-name, same-step Task's `template_task` at its template task in one batch, then clear and set `task_template`. The server creates only what is missing, and copies dependencies onto claimed Tasks too. |
| `findings/085_task_dependency_types`, `recipes/016_create_tasks_with_dependencies` | Four dependency types; `offset_days` in working days, may be negative; `task` is the downstream Task, `dependent_task` the upstream one. |
| `findings/086_batch_tasks_with_dependencies` | One `_batch` cannot link rows it creates. |
| `findings/087_dependency_cascade` | Unpinned downstream Tasks move with their upstream; pinned ones stay and flag `dependency_violation`. Writing a Task's own dates pins it. |
| `findings/088_project_template_defaults` | The default per entity type is `Project.tracking_settings.default_task_template.<Type>`. Whether API create applies it is unmeasured. |
| `findings/089_task_delete_side_effects` | Deleting a Task orphans `Version.sg_task` and `PublishedFile.task` and cuts the dependency chain. Revive restores all of it. |
| `findings/090_template_task_events` | Every apply is in the event log under the writer; filter on `attribute_name` `template_task`. |
| `recipes/002_batch`, `reports/001` | A batch is atomic and ordered; a create inside a batch skips validation. |
| `findings/052`, `recipes/012` | Sign in as a person with the App Session Launcher. |

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
   - Key: `content` trimmed and casefolded, plus step id. The plan shows the normalized match.
   - A Task linked to another template's task with the same key is claimed. The plan shows the old
     link and the undo record keeps it.
   - Two Tasks on one entity with the same key: a conflict the user resolves, with a pre-pick: the one
     with Versions or PublishedFiles, then a status other than the default, then the oldest.
3. **Extras** (Tasks on the entity that the template lacks)
   - Listed under each entity. One action each: **leave** (default), **omit** (status) or **delete**.
     Bulk-set by name.
   - Delete asks for a second confirmation. A Task with Versions or PublishedFiles linked can be
     deleted, with a loud warning that shows the counts (089). Undo revives it.
4. **Kept and claimed Tasks**
   - Per-field opt-in, per run: duration, description, sort order, milestone, estimate. Each is
     keep (default) / overwrite / fill if empty. Only the link is written otherwise.
   - Dependencies: the server adds the template's edges on claim. Edges between template Tasks that
     the template no longer has are listed, and removing them is opt-in.
   - Template dates on created Tasks: shown in the plan, with an opt-in to clear them after apply.
   - Tasks whose dates may move because of new edges are shown. Pinned Tasks are never touched; the
     plan shows those that would flag `dependency_violation`.
5. **Default template**: in v1 as an entry filter. "Entities with no template" in the project, with
   the template pre-selected from `tracking_settings.default_task_template.<Type>` (088). Same apply
   path; nothing relies on the unmeasured API-create behaviour.
6. **Writing**
   - One batch per entity. A failure stops that entity only; the run continues and the result lists
     failures with a retry.
   - Small concurrency (about 4 entities in flight), async in the browser, with progress.
   - Undo in v1. Per run, per entity as it lands: previous `template_task`, old field values, removed
     edges, previous status of omitted Tasks, deleted Task ids, created Task ids. Revert = restore,
     revive (048), delete created.
   - The undo record lives in IndexedDB and downloads as JSON. Undo works from either.
   - A tab closed mid-run: on reopen the unfinished run is offered. Re-plan the remaining entities from
     a fresh read, then continue or undo.
7. **Who uses it**
   - Anyone, writing as themselves. No level gate: permission rules are not readable (027).
   - Before the plan, a few harmless calls test write access and warn if it looks short. Failed writes
     are reported per entity.
   - A template whose `entity_type` differs from the entity: warning in the plan, allowed.
8. **Output**: the plan as CSV, for review before applying; the result as the undo record JSON.
9. **Views**
   - Screens: connect, template, entities, plan, apply and result.
   - Plan: entity list on the left with counts (keep, claim, create, extra, conflict), filterable;
     detail pane on the right with that entity's Tasks and actions; bulk actions on top.
   - Default theme only. Light and dark switch in the navbar, following the system preference at
     first. The docs say any sg-widgets theme can be swapped in.
10. **Later, not v1**: combining several templates on one entity; relative offsets and date shift
    (idea E); cross-project runs. No Qt version.

## Corpus gaps (probes before the work)

One sg-groundtruth issue with these questions, probes, PR to `dev`.

- Does adding a dependency edge (the server's copy on claim) reschedule unpinned downstream Tasks, or
  only a date write (087)?
- Does clearing `start_date` and `due_date` on a Task pin it?
- A harmless way for a person to learn whether they can update Tasks and entities, and create and
  delete Tasks, before writing.
- Removing a dependency edge, and restoring it on undo: which call, and what it does to dates.
- Restoring `template_task` on undo: does writing the old value back behave like the claim?

## Client gaps (sg-widgets)

`delete` and `batch`, already known. Revive (048) if the client lacks it. Issue and PR there.

## Next

- Next steps, waiting on Kevin's go: the sg-groundtruth probe issue (corpus gaps above), the
  sg-widgets client issue, the `ksallee/sg-task-templates` repo with `dev` and `main`.

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
