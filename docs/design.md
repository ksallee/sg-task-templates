# Design

sg-widgets' default theme and `docs/design-rules.md` there bind everything below: tokens only, its
spacing and size ladders. The theme comes from sg-widgets; layout, hierarchy, illustration and copy
are this app's. The app reads as sg-notes' sibling.

## What was wrong (2026-09-24, seeded sandbox, 1440×900)

- **All screens.** No page title; the first line is a toolbar. Nav tabs say where you are, not what is
  done or what waits. Primary actions sit bottom-right in footers, secondary ones share their weight.
- **Connect.** Four loose lines top-left; the site is a raw URL; nothing says what signing in changes.
- **Template.** The type picker vanishes while types load. 40 templates in one unlabelled list. The
  preview is two flat tables; dependencies are an edge list you rebuild in your head. The three entry
  points are three equal outline buttons behind "Then the entities:", with no word on which to pick.
- **Entities.** "1 selected" is the smallest text on the page. The entry toggle has no label and no
  explanation. Select all and Clear are ghost links far from the table.
- **Plan.** Bulk options fill a third of the screen before the entities. Counts are three styles:
  mono `keep 10`, list `kp 10 cl 0`, headings `Keep 10`; colours only on some.
- **Apply.** Totals in mono with no colour; `task_template` jargon in the list; the confirm reads as
  a footnote. **Result.** Empty state is a bare line with the action far right.

## Direction

- **Shell.** Header `h-12`, as sg-notes: wordmark, the step indicator, site host and who, scheme
  switch. Resume banner under it. The page owns everything else.
- **Step indicator.** Drawn only on the six flow screens; home and How it works hide it
  (`inFlow` in `$lib/pure/flow.ts`). Below `sm` the chevrons go and the wordmark keeps its mark, so
  the header fits a phone. Connect → Template → Entities → Plan → Apply → Result, numbered. Current: primary
  ring and foreground label. Done: a check, muted label, still a link. Open: muted, link. Blocked:
  half opacity, not a link, the reason in its title. Rules in `$lib/pure/flow.ts`.
- **Page header.** Every screen: title `text-lg font-semibold`, one context line `text-sm
  text-muted-foreground` (project · type · template), actions on the right with the primary last.
  One next step lives here, never in a footer; a choice between paths is a row of choice cards
  where the choice is made. `border-b`, `px-6 py-4`.
- **Grid.** Workbench screens (template, entities, plan) are full width: a left rail `w-80`
  and a detail pane, both scrolling on their own. Forms and summaries (connect, apply) sit in one
  column `max-w-3xl`, `px-6`. The result is a grid of entity cards, full width: 3 across from
  `xl` (1280), 2 from `md`, 1 on a phone; equal widths, heights as content. Failed and with
  differences first, outlined in their tone, then applied, undone, not applied. A card: name, state,
  menu; its counts in one line; the error with Retry or the differences; its Tasks one `h-6` line
  each, the Pipeline Step in a `w-20` column on the left. Unchanged entities fold into one line.
- **Type.** Page title `text-lg font-semibold`. Section title `text-sm font-semibold`, its count or
  note beside it `text-xs text-muted-foreground`. Group heading in a list `text-xs font-medium
  text-muted-foreground`. Body `text-sm`. Meta `text-xs text-muted-foreground`. Codes and keys
  `font-mono text-xs`. Numbers `tabular-nums`, right-aligned in columns.
- **Spacing.** sg-widgets' scale: page sections `gap-6`, inside a section `gap-3`, fields `gap-4`,
  items in a row `gap-2`, rows `px-2 py-1.5` with no gap. Cards `rounded-lg border bg-card p-4`.
- **Density.** Compact rows in lists and tables (sg-widgets `density="compact"`); air goes between
  sections, not inside rows.
- **The five counts.** One `CountChip` everywhere: a dot, the word, the number. The words come from
  `$lib/pure/kinds.ts` (code keeps keep, claim, create, extra, conflict): Already linked = muted
  (linked to this template before the apply), Linked = info (matched by name and Step, linked),
  Created = success (missing on the entity, created from the template), Not in template = warning
  (not changed unless requested), Needs a choice = destructive (several Tasks match one template
  task). Zero is dimmed. Needs a choice above zero outlines in destructive. In a narrow list,
  `compact` drops the word and keeps the dot and number.
- **Badges.** Chips paint no fill of their own (sg-widgets rule 1): `border`, `text-xs font-medium`,
  `h-5`. Status chips come from the registry's `StatusBadge`.
- **Actions.** One primary (`default`) per screen, top right. Secondary `outline`. Tertiary `ghost`.
  Destructive only for delete and undo. Choices between paths are cards with a title, one line of
  when to use it, and a button, not a row of equal buttons.
- **Warnings.** `Notice`: bordered, tinted `bg-<tone>/10`, `size-4` icon, one sentence then the
  action. Tones: warning, destructive, info. Never raw amber/emerald classes.
- **States.** `PageState` for a whole pane: icon in a muted circle, one title, one line, one action.
  Loading shows skeletons shaped like the rows (lists) or a muted line with a spinner after 150 ms
  (whole page). Errors say what failed and offer the way back. Inside a widget, its own `StateLine`.

Shared pieces: `src/lib/app/` (`app-shell`, `flow-steps`, `page-header`, `section`, `count-chip`,
`notice`, `undo-download-only`, `page-state`, `segmented` (a small choice, the pick raised), `wordmark`).

## Plan states (2026-09-24, #48)

Every state the plan can put a Task, a field, an edge or an entity in, from `types.ts`, `planner.ts`,
`edges.ts`, `plan-view.ts` and the decisions. **Needs you**: the plan waits on the user. **Shown
as**: *headline* is a line of the run summary on top of /plan; *label* is the Task's one outcome
label; *marker* a small tag beside it; *detail* only in the Task's fold or the Dependencies fold.
`$lib/pure/plan-summary.ts` turns plans into these.

### Tasks

| state | what a producer cares about | needs you | shown as |
|---|---|---|---|
| keep, nothing changes | Already on the template; the apply leaves it as it is. | no | label **already linked**; headline count |
| keep, fields rewritten back (policy keep) | The apply re-syncs it, the app writes its values back: no visible change. | no | detail |
| keep, a field overwritten or filled-if-empty | Its value becomes the template's. | no | label **updated**, marker *fields change*; headline "fields change" |
| keep, renamed back (hand-renamed, name policy = template) | Someone renamed it; it gets the template's name back. | no, opt-out by run option | label **updated**, marker *renamed* (loud); headline "renamed" |
| keep, key mismatch (linked, name or step moved) | Still the same Task; it stays linked. | no | detail |
| keep or claim, assignees filled | People are put on a Task that had none. | no | marker *assignees filled*; headline "filled" |
| keep or claim, dates filled | A Task with no dates gets the template's, then follows its upstream. | no | marker *dates filled*; headline "filled" |
| claim, same name | An existing Task is linked to the template instead of a duplicate. | no | label **linked**; headline |
| claim, renamed | Linked, and takes the template's name (casing, spacing). | no, opt-out | label **linked + renamed**; headline "renamed" |
| claim, from another template | Its old link, shown so the switch is visible; undo keeps it. | no | detail |
| create, template dates | A new Task, with the template's fields and its calendar dates. | no | label **created**; headline |
| create, dates cleared | New, no dates (clear-dates option, only without upstream). | option | detail |
| create, has upstream | Its dates follow the upstream Task; not clearable. | no | detail |
| extra, leave | On the Shot, not in the template: stays as it is. | no, default | label **not in template**; headline |
| extra, omit | Stays, its status becomes the omit status. | yes (choice) | label **omitted**; headline |
| extra, delete | Removed; Versions and Published Files are orphaned (089). Undo revives it. | yes, in the Apply dialog | label **deleted**, marker *has publishes* (loud); headline, with the count that has publishes |
| extra, reason not in template | Why it is extra. | no | detail |
| extra, reason link wins | Same name as a template task another Task is already linked to. | no | detail |
| extra, reason conflict loser | Lost a conflict; unlinked when it was linked there (106). | no | detail |
| extra, still linked and re-synced | Another template task's link: the apply re-syncs its fields too. | no | marker *fields change* when a value changes; detail |
| conflict, unresolved (pre-pick shown) | Several Tasks match one template task, or the template has the key twice: pick one. | **yes** | label **needs a choice**, listed first; headline "need a choice" |
| conflict, user pick or accepted pre-pick | Resolves to linked / unchanged / created, the others to extras. | no | the resolved label; the picker in the fold |
| conflict, create new | The template task gets a new Task; every candidate becomes an extra. | no | label **created** |
| downstream of a new edge, unpinned | Its dates may move when the apply lands (092). | no | marker *dates may move*; headline |
| downstream of a new edge, pinned | Keeps its dates, flags a dependency violation (092). | no | marker *would flag violation*; headline |

### Edges

| state | what a producer cares about | needs you | shown as |
|---|---|---|---|
| added (template edge the entity lacks) | A new dependency; may move dates. | no | headline count; Task detail "will wait on"; Dependencies fold |
| removed by the server, action keep (default) | Dropped by the apply, re-created after as a new edge. | no, can remove | headline count; Task detail; Dependencies fold with keep / remove |
| removed, action remove | Gone after the run. | option | headline count; same |
| replaced by the template's (other type, offset, direction) | The template's version wins unless kept. | option | Task detail; Dependencies fold |
| outside upstream (upstream not linked to the template, 109) | Erased by the apply; kept by default (re-created). | option | Task detail; Dependencies fold |
| outside downstream | Kept by the apply; information. | no | Dependencies fold |
| would close a loop | Cannot be kept: removed (085, 107). Keeping it blocks Apply. | only if kept | headline; Dependencies fold; blocker |
| date impact may move / would violate | See Tasks above. | no | headline, marker |

### Fields and run options

| state | what a producer cares about | needs you | shown as |
|---|---|---|---|
| policy keep (default) | Values stay the Task's. | option | run options line |
| policy overwrite / fill if empty | Values become the template's. | option | run options; *fields change* marker per Task |
| name policy template (default) / keep | Renames happen / do not. | option | run options; *renamed* |
| omit status missing | The project has no `omt`: pick one before Apply. | **yes** | blocker, run options line |

### Entities

| state | what a producer cares about | needs you | shown as |
|---|---|---|---|
| noop | Already matches: nothing is written. | no | headline "nothing to write"; entity line |
| needs clear first | Already on this template: the write clears then sets it (084). | no | detail (entity header) |
| template type mismatch | The template is for another type; allowed (083). | no | headline; entity notice |
| unresolved conflict / invalid pick | Pick before Apply. | **yes** | headline; entity line; blocker |
| kept edge closes a loop | Removed by default. | only if kept | headline; blocker when kept |
| access looks short | The server may refuse the writes (094). | **yes** | blocker notice |
| per entity | One line: "3 linked, 8 created, 1 needs a choice". | no | entity list |

On /plan the five counts give way to these outcomes: the run summary on top (`plan/run-summary`), one
outcome line per entity, Tasks one line each (`plan/outcome-chip`, markers in `plan/tone.ts` tones),
details folded. Fields show their display names (Task schema with `project_id`), the code name on
hover and in the CSV beside it.

The plan shows once the reads end; the access check (094) runs on in the background. Meanwhile a
small line by Apply says "Checking write access" and Apply waits (`applyGate` in `plan-view.ts`).
Apply opens a confirm dialog (`plan/apply-dialog`, content from `$lib/pure/apply-confirm.ts`): one
line of totals; when Tasks are deleted, a destructive notice on top ("N Tasks will be deleted. V
Versions and P Published Files will be orphaned.") and each Task with its counts; then only the
risky items (omits, hand-renamed Tasks, fields overwritten from the template), the download-only
undo warning when the store is not persistent, Cancel and the confirm button. It reads Apply, or
"Apply and delete N Tasks" in the destructive tone. It starts the run and opens /apply, which
shows the run only.

## Home and How it works (2026-09-24, #57)

Outside the flow: no step indicator, no page header bar; each page owns its composition.

- **Home.** One centred column (`max-w-4xl`). Title `text-3xl sm:text-4xl font-semibold`, one line
  under it, Start (the only one) and a ghost How it works. The one picture is `app/merge-picture`: a
  Shot's Tasks after Flow PT's apply (duplicates in warning, the deleted Task struck in destructive
  with its orphaned publishes) beside this app's (linked in info, created in success, the plan's
  words). The two panels share a subgrid, so each Task is level with its counterpart. Then the six
  steps (numbered: a sequence) and what it never does, `text-lg` section titles.
- **How it works.** A docs page: a side nav of `HOW_SECTIONS`, sticky from `lg`, marking the section
  in view (`activeSection` in `$lib/pure/how.ts`); a wrapped link row above `lg`. Text at a reading
  measure (`max-w-[42rem]`, 15px, relaxed). Section titles `text-xl`, sub-titles `text-base`,
  sections split by a rule. A small picture where it clarifies a rule: name matching examples, a
  glyph per outcome (`app/how/outcome-glyph`), a keep / template's / fill-if-empty table, the removed
  and re-created edge (`app/how/edge-strip`), undo's puts back vs not exactly. Anchors unchanged.
