# sg-task-templates

Apply a task template to Shots and Assets that already have Tasks, and merge instead of duplicating: a
Task with the template task's name and step is kept, with its status, assignees and publishes; only
what is missing is created; nothing is deleted unless asked, and never silently. Every change is shown
per entity before it is written. Built on `../sg-widgets`, public on GitHub, a Svelte app like sg-notes.

Status, 2026-09-25: built. Every screen (connect, template, entities, plan, apply, result), undo and
resume, the plan CSV, the seed tool, Home and How it works, the stamp. Left for release: a pass on the
result page, Kevin's QA on `dev`, the promote to `main`, the Vercel project, and screenshots of every
state for How it works ([#56](https://github.com/ksallee/sg-task-templates/issues/56)).

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

From sg-groundtruth `main`, tag `corpus/2026-09-24.1`. Read `corpus/INDEX.md` first, then these.

| entry | rule the app rests on |
|---|---|
| `findings/entity_types/TaskTemplate.md` | A template's Tasks are Task rows with `task_template` set and `project` null. Deleting a template deletes its Tasks. The template's `entity_type` is not enforced. |
| `findings/083_task_template_on_create` | Creating an entity with `task_template` makes the Tasks in the same call: step, status, sort order, duration, estimate, description, milestone, assignees, dependencies with type and offset. Dates copy as the same calendar dates. |
| `findings/084_task_template_reapply` | Writing `task_template` creates one Task per template task no Task points at through `template_task`. Never removes, never merges by name. Runs only when the value changes. No mode. It also re-syncs the Tasks already linked: 096 and 102. |
| `recipes/015_apply_task_template_without_duplicates` | The merge: point each same-name, same-step Task's `template_task` at its template task, then clear and set `task_template`. The server creates only what is missing. |
| `findings/085_task_dependency_types`, `recipes/016_create_tasks_with_dependencies` | Four dependency types; `offset_days` in working days, may be negative; `task` is the downstream Task, `dependent_task` the upstream one. |
| `findings/086_batch_tasks_with_dependencies` | One `_batch` cannot link rows it creates. |
| `findings/087_dependency_cascade` | Unpinned downstream Tasks move with their upstream; pinned ones stay and flag `dependency_violation`. |
| `findings/088_project_template_defaults` | The default per entity type is `Project.tracking_settings.default_task_template.<Type>`. Whether API create applies it is unmeasured. |
| `findings/089_task_delete_side_effects` | Deleting a Task orphans `Version.sg_task` and `PublishedFile.task` and cuts the dependency chain. Revive restores all of it. |
| `findings/090_template_task_events` | Every apply is in the event log under the writer; filter on `attribute_name` `template_task`. |
| `recipes/002_batch`, `reports/001` | A batch is atomic and ordered; a create inside a batch skips validation. |
| `findings/052`, `recipes/012` | Sign in as a person with the App Session Launcher. |
| `findings/092_dependency_edge_reschedule` | An added edge (direct, or the apply's copy) reschedules unpinned downstream Tasks at once; a pinned one holds and flags `dependency_violation`. The claim alone moves nothing. |
| `findings/093_clear_dates_pin` | On a dependent Task, a `start_date` write pins it, null or a real date. A `due_date` write never pins; it recomputes `duration`. `pinned: false` recomputes both dates from upstream. |
| `findings/094_permission_preflight`, `recipes/017_check_permission_before_writing` | Access check that writes nothing. `GET /schema/<Type>/fields?project_id=` gives `editable` per field: `false` is a refusal, `true` only maybe. Then three writes the server refuses before landing: a no-op PUT, a create with a bad `sg_status_list`, a `_batch` [delete, update of a missing id]. Partial: measured via `sudo_as`. |
| `findings/095_dependency_remove_undo`, `recipes/018_remove_and_restore_a_dependency` | Remove an edge with `DELETE /entity/task_dependencies/<id>`, never through `upstream_tasks` or `downstream_tasks` (erased, no revive). Revive brings back the same id, type and offset; dates recompute from upstream. Reviving after the same pair is re-created is a 400. |
| `findings/096_task_template_unmerge`, `recipes/019_undo_task_template_merge` | Writing `task_template` re-syncs Tasks already linked to it. Undo order: old `template_task` on claimed Tasks, old `task_template` on the entity, delete created Tasks, write back fields and edges. |
| `findings/097_null_dates_unpin` | A Task with no upstream edge never pins. Cleared dates stay null. |
| `findings/098_template_merge_in_one_batch`, `recipes/020_apply_task_template_in_one_batch` | One `_batch` (claims, `task_template` null, `task_template` T, write-backs) sees each request's earlier writes: one batch per entity. |
| `findings/099_template_apply_edge_copy_kept` | Every `task_template` write reconciles all template edges against `template_task` links: kept+claimed, kept+kept and kept+created pairs all get the missing edge. |
| `findings/100_duration_write_pin` | Writing `duration` does not pin; it recomputes dates from upstream and cascades downstream. |
| `findings/101_template_edge_conflict` | A template edge replaces an edge of another type or the reverse edge. The old one is erased, not revivable: re-create it from the recorded type and offset. |
| `findings/102_task_template_resync` | Writing `task_template`=T re-syncs every Task linked to T. Fields: the list under Decided 4. Edges between T-linked Tasks: missing template edge added, other type or offset replaced by T's, non-template edge deleted. Writing `null` or another template touches no T-linked Task. |
| `findings/103_batch_delete_revive`, `recipes/021_undo_a_batch_delete` | A delete inside `_batch` retires a Task or edge as `DELETE` does. Revive restores the same id, fields, edges and `Version.sg_task`. |
| `findings/104_template_unmerge_in_one_batch`, `recipes/022_undo_task_template_merge_in_one_batch` | Undo works as one `_batch`. It must not delete edges its own `task_template` write removes: a 404 rolls the batch back. |
| `findings/105_offset_days_null_vs_zero` | `offset_days` null and 0 differ to the server. The apply replaces an edge whose offset differs only that way. |
| `findings/106_template_task_linked_twice` | Two Tasks on one template task: the server wires only one, and which one is unpredictable. The apply unlinks the losers of a choice first. |
| `findings/107_dependency_three_task_loop` | Loops of three or more Tasks are refused; a batch that makes one rolls back. |
| `findings/108_task_template_resync_empties` | On re-sync, a numeric 0 on the template overwrites; an unticked milestone keeps the Task's tick; `""` on a template text field acts empty. `duration` only on a Task with no dates. |
| `findings/109_template_apply_outside_edge` | On apply, every edge where a T-linked Task depends on a Task not linked to T is erased. Edges where the outside Task is downstream are kept. |
| `findings/110_template_task_after_revive` | Revive restores `template_task`. Undo revives deleted Tasks before it writes the old template. |
| `findings/111_template_undo_outside_edge` | Undo's write of the old template erases every edge whose downstream Task it holds and it lacks. Undo re-creates pre-merge edges by pair, not by id. |
| `findings/112_template_unmerge_linked_twice`, `recipes/023_undo_task_template_merge_with_a_task_linked_twice` | Undo with two Tasks on one old template task: relink the Task that had the edges before the template write, the other after it. The field write-back includes `content`. |

## Decided

- **Web, SvelteKit at the repo root**, one process, deployed on Vercel from `main`, like sg-notes.
  Public repo `ksallee/sg-task-templates`, MIT.
- **Sign-in as a person** through the App Session Launcher, token in the browser, no script key, no
  server holding secrets. Writes land in the event log under the person.
- **The merge is recipe 015, as one batch per entity (recipe 020).** The app never re-implements what
  the server's apply already does (copying fields and dependencies onto new Tasks).
- **Preview before write, always.** Nothing is written from a screen that has not shown the plan.
- **Live only, no mock**, as sg-notes. A dev-only token route for headless drives.
- **Widgets are registry copies** from sg-widgets. What the client lacks grows in sg-widgets, issue and
  PR there, never a private extension here.
- **No LLM in the app.** Deterministic. Nothing that looks like configurable automations or an agent
  writing app config (flowpilot overlap, see `~/Desktop/SG APPS.md`).
- **Design.** sg-widgets' default theme, fixed. Design passes use Anthropic's frontend-design skill.
  Jeremy is not on this project. `docs/design.md` holds the rules.

## Decided in the grilling session (2026-09-24) and after

1. **Scope of a run**
   - One project per run.
   - Every entity type a Task links to (`Task.entity`'s valid types) that has a `task_template`
     field, custom entities included. Task is left out: its `task_template` marks template tasks.
   - One path: pick the template, then the entities. The entities list has one filter: All, Using
     this template, Other template or No template (#59). It opens on Using this template when an
     entity uses it, else All. Nothing is pre-selected.
2. **Matching**
   - Key: `content` trimmed, casefolded, inner whitespace runs collapsed to one space, plus step id.
     The plan shows the normalized match.
   - A Task linked to another template's task with the same key is linked to this one. The plan
     shows the old link and the undo record keeps it.
   - Two Tasks on one entity with the same key: the user picks one, with a pre-pick: the one with
     Versions or PublishedFiles, then a status other than the default, then the oldest. Accept all
     pre-picks takes them all in one click. If one of the two is already linked to this template's
     task, the link wins and there is no choice; the other Task is not in the template, left by
     default.
   - The template itself with two tasks of one key: the user picks in the plan.
   - The apply unlinks the Tasks not picked before the template write (106).
3. **Tasks not in the template**
   - Listed under each entity. One action each: **leave** (default), **omit** (a status) or
     **delete**. Bulk-set by name.
   - Delete asks for a second confirmation, in the Apply dialog. A Task with Versions or
     PublishedFiles linked can be deleted, with a loud warning that shows the counts (089). Undo
     revives it.
4. **Linked Tasks**
   - What the apply does to linked Tasks (102, 108). Overwritten when the template's value is
     non-empty: `content`, `step`, `est_in_mins`, `sg_description`, `sg_sort_order`,
     `task_reviewers`, `milestone`, custom fields; `duration` only on a Task with no dates. Kept:
     `sg_status_list`. `start_date` and `due_date` kept when set, filled then cascaded when empty.
     Filled only if empty: `task_assignees`. An empty template value never clears a field.
   - Per-field policy, per run, over every overwritten field, custom fields included: keep (default),
     overwrite, or fill if empty. Keep reads the field before the apply and writes it back after, in
     the same batch (098). Milestone and other booleans: keep or overwrite only.
   - `content` (the Task's name): default is overwrite, to the template's name; keep on opt-in. The
     plan flags every rename, loudly when a linked Task was renamed by hand.
   - Dependencies: the apply adds every missing template edge between linked Tasks (099). It deletes
     non-template edges between linked Tasks, replaces edges of another type, offset or direction
     (101, 102, 105), and erases edges where a linked Task depends on an outside Task (109). The plan
     lists each with keep (default) or remove. Keep re-creates it after the apply, in the same batch,
     as a new edge id, from the recorded type and offset. That may move dates (092); the plan shows
     it.
   - Template dates on created Tasks: shown in the plan, with an opt-in to clear them, offered only on
     Tasks with no upstream edge; those stay unpinned with null dates (097).
   - Tasks whose dates may move are shown. Pinned Tasks are never touched; the plan shows those that
     would flag `dependency_violation`.
5. **Default template**: the template in `tracking_settings.default_task_template.<Type>` (088) is
   tagged Project default and pre-selected. Same apply path; nothing relies on the unmeasured
   API-create behaviour.
6. **Writing**
   - One `_batch` per entity, write-backs included (098). A failure stops that entity only; the run
     continues and the result lists failures with a retry.
   - The read just before the write is compared with the plan's read: a changed entity is not
     written, and the result lists what changed. A retry never resends a batch: the entity is read
     and planned again on the plan screen. A failed batch is atomic (113); the second call (date
     clears, kept edges) is built from the read-back, and its failure leaves the first standing,
     with its record to undo.
   - About 4 entities in flight, async in the browser, with progress. Cancel stops after those in
     flight.
   - Apply opens a confirm dialog: one line of totals, the deletes on top with their publish
     counts, then only what is risky (omits, hand-renamed Tasks, fields overwritten). Its button
     starts the run: "Apply and delete N Tasks" when Tasks are deleted.
   - Undo per run and per entity, after a confirmation that lists what undo cannot put back. The
     record per entity: previous `template_task`, previous values of every field under policy,
     `content` included, removed or replaced edges, previous status of omitted Tasks, deleted Task
     ids, created Task ids. The revert is one `_batch` (recipe 022): revive deleted Tasks first
     (110), old `template_task` on linked Tasks, the entity's old `task_template`, the second Task
     on a shared old template task (112, recipe 023), delete created Tasks, then fields and statuses.
     Edges are revived (095) or re-created by pair from the record (111). Dates are not restored:
     writing them pins (087, 093).
   - The undo record lives in IndexedDB and downloads as JSON. Undo works from either.
   - A tab closed mid-run: on reopen a banner offers the run. Continue re-plans what never landed
     from a fresh read. Review and undo opens it on the result screen.
7. **Who uses it**
   - Anyone, writing as themselves. No level gate: permission rules are not readable (027).
   - An access check (recipe 017, probe 094) that writes nothing. The plan shows at once; the check
     runs beside it and Apply waits on it. It warns if access looks short. Failed writes are
     reported per entity.
   - A template whose `entity_type` differs from the entity: warning in the plan, allowed.
8. **Output**: the plan as CSV, for review before applying, values as they are (no formula guard);
   the result as the undo record JSON.
9. **Views**
   - Home (what it does, as a before and after picture) and How it works (the rules, one section
     each). Then the flow: connect, template, entities, plan, apply and result, with a step indicator
     in the header.
   - Plan: a run summary on top (If you apply; each line filters the entities), run options
     collapsed to one line, the entity list on the left, the picked entity's Tasks on the right.
     Each Task shows one outcome: **Already linked** (linked to this template's task before the
     apply), **Linked** (matched by name and Step, link written), **Created** (missing, the apply
     makes it), **Not in template** (not changed unless requested), **Needs a choice** (several Tasks
     match one template task). The code names them keep, claim, create, extra, conflict.
   - The app's mark is a stamp over its imprint, in the favicon and the header.
   - Light and dark switch in the navbar, following the system preference at first. The docs say
     any sg-widgets theme can be swapped in.
10. **Later, not v1**: combining several templates on one entity; relative offsets and date shift
    (idea E); cross-project runs. No Qt version.

## Corpus gaps

- 094 partial: measured via `sudo_as` as an Artist, not a real App Session Launcher session.
- Undo with two Tasks on one old template task, both with edges: unmeasured (112).

## Client

`sg-widgets-core` 0.3.0 from npm: `delete`, `revive` and `batch` on `SgClient`
([sg-widgets #330](https://github.com/ksallee/sg-widgets/issues/330)).

## Next: release

1. A pass on the result page.
2. Screenshots of every state for How it works (#56).
3. Kevin QAs `dev` against the seeded sandbox.
4. Promote `dev` to `main`: a PR, merge commit.
5. The Vercel project, `sg-task-templates.vercel.app`, deployed from `main`, with only
   `PUBLIC_FPT_SITE_URL` set (`docs/development.md`).

## Engineering rules

- Pure functions in their own modules (`src/lib/pure/`): the planner, matching, edges, the batch
  builder, undo, the result reader, the view logic. No I/O in them.
- Components only when needed. Pages and views as thin as possible, with as little logic as possible.
- Unit tests for every pure module, written first, fixtures shaped like the corpus responses.
- API behaviour comes from the corpus. A gap is a probe in sg-groundtruth first: one issue, a PR to
  `dev`.
- Process as everywhere: issue, branch from `dev`, PR onto `dev`, squash; `main` by a merge-commit PR
  after Kevin QAs.

## Sources

- `../sg-groundtruth`: the corpus. `corpus/INDEX.md` first, then the table above.
- `../sg-notes`: the host pattern. `docs/development.md` (deploy), `src/routes/live/` (the launcher
  routes and the dev token route), `src/lib/live.ts`.
- `../sg-widgets`: the client and the widgets. Its `CLAUDE.md`; the registry install one-liner.
- `~/Desktop/SG APPS.md` and `~/Desktop/SG APPS research/`: the forum evidence.

Clean room: never read `~/dev/fpt-ai`, `~/dev/fpt-api`, `~/dev/flow-data-api-docs`,
`~/dev/flow-data-sdk-python`, `~/dev/tk-*`, `~/dev/flowpilot`. Public shotgunsoftware repos are fine.
