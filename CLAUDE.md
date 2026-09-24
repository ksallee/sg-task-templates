# sg-task-templates

`BRIEF.md` is the plan: what the app does, the decisions, the corpus and client gaps still open.
Read it first.

## Rules

- Pure functions in their own modules, under `src/lib/pure/`, no I/O in them: the planner
  (template + entity Tasks → plan), matching, the batch builder, the result reader. Components
  only when needed. Pages and views as thin as possible, with as little logic as possible.
- Unit tests for every pure module, written first (TDD), colocated as `<module>.test.ts`,
  fixtures shaped like the corpus responses. Integration or E2E tests where a flow needs them
  (apply against the sandbox project).
- API behaviour comes from `~/dev/sg-groundtruth/corpus` (read `INDEX.md` first). Never guess. A
  gap is a probe in sg-groundtruth first: one issue, a PR to `dev`.
- Live only, no mock, as `../sg-notes`. `src/lib/live.ts` and the `src/routes/live/` endpoints are
  that app's App Session Launcher sign-in, adapted; `docs/development.md` there is the pattern for
  running and driving this one once it has more to drive.
- Widgets are registry copies from `../sg-widgets`, installed with its documented one-liner. What
  the client lacks grows there: issue, PR, merge to `dev` and `main`, never a private extension
  here.
- One theme (`src/app.css`, sg-widgets' default). Light/dark only, in the navbar, following the
  system preference until a person picks one.
- No LLM in the app. Deterministic.

## Process

- Issue: one paragraph, edited in place when scope changes. No issue comments.
- Branch from `dev` (`feat/<issue>-slug` or `fix/slug`). PR onto `dev`, squash-merged, once
  `pnpm check` and `pnpm test` are green.
- `main` is promoted by a PR from `dev`, merge commit, after Kevin QAs `dev`.
- Merging to `dev` or `main` needs Kevin's say in the session.

## Commands

    pnpm install / pnpm dev / pnpm check / pnpm test / pnpm build
