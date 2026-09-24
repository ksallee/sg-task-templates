# Design

sg-widgets' default theme and `docs/design-rules.md` there bind everything below: tokens only, its
spacing and size ladders. Theme choices are Jeremy's (sg-widgets #190). The app reads as sg-notes' sibling.

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
- **Step indicator.** Connect → Template → Entities → Plan → Apply → Result, numbered. Current: primary
  ring and foreground label. Done: a check, muted label, still a link. Open: muted, link. Blocked:
  half opacity, not a link, the reason in its title. Rules in `$lib/pure/flow.ts`.
- **Page header.** Every screen: title `text-lg font-semibold`, one context line `text-sm
  text-muted-foreground` (project · type · template), actions on the right with the primary last.
  One next step lives here, never in a footer; a choice between paths is a row of choice cards
  where the choice is made. `border-b`, `px-6 py-4`.
- **Grid.** Workbench screens (template, entities, plan, result) are full width: a left rail `w-80`
  and a detail pane, both scrolling on their own. Forms and summaries (connect, apply) sit in one
  column `max-w-3xl`, `px-6`.
- **Type.** Page title `text-lg font-semibold`. Section title `text-sm font-semibold`, its count or
  note beside it `text-xs text-muted-foreground`. Group heading in a list `text-xs font-medium
  text-muted-foreground`. Body `text-sm`. Meta `text-xs text-muted-foreground`. Codes and keys
  `font-mono text-xs`. Numbers `tabular-nums`, right-aligned in columns.
- **Spacing.** sg-widgets' scale: page sections `gap-6`, inside a section `gap-3`, fields `gap-4`,
  items in a row `gap-2`, rows `px-2 py-1.5` with no gap. Cards `rounded-lg border bg-card p-4`.
- **Density.** Compact rows in lists and tables (sg-widgets `density="compact"`); air goes between
  sections, not inside rows.
- **The five counts.** One `CountChip` everywhere: a dot, the word, the number. Keep = muted (nothing
  changes), claim = info (a link is written), create = success (a Task appears), extra = warning (not
  in the template), conflict = destructive (you must pick). Zero is dimmed. A conflict above zero
  outlines in destructive. In a narrow list, `compact` drops the word and keeps the dot and number.
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
`count-chips`, `notice`, `page-state`, `wordmark`).
