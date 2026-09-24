# sg-task-templates

`BRIEF.md` is the plan: what the app does, the decisions, the corpus and client gaps still open.
Read it first.

## Rules

- Pure functions in their own modules, no I/O in them: the planner (template + entity Tasks →
  plan), matching, the batch builder, the result reader. Components only when needed. Pages and
  views as thin as possible, with as little logic as possible.
- Unit tests for every pure module, written first (TDD), fixtures shaped like the corpus
  responses. Integration or E2E tests where a flow needs them (apply against the sandbox project).
- API behaviour comes from `~/dev/sg-groundtruth/corpus` (read `INDEX.md` first). Never guess. A
  gap is a probe in sg-groundtruth first: one issue, a PR to `dev`.
- Live only, no mock, as `../sg-notes`. `src/lib/live.ts` and the `src/routes/live/` endpoints are
  that app's App Session Launcher sign-in, adapted.
- Widgets are registry copies from `../sg-widgets`. What the client lacks grows there, issue and
  PR there, never a private extension here.
- Default theme only (`src/app.css`, sg-widgets' default). Light and dark switch in the navbar,
  following the system preference at first.
- No LLM in the app. Deterministic.

## Layout

- Pure modules in `src/lib/pure/`, each with its test beside it as `<module>.test.ts`.
- `docs/development.md`: running the app and the deploy.

## Process

- Issue: one paragraph, edited in place when scope changes. No issue comments.
- Branch from `dev` (`feat/<issue>-slug` or `fix/slug`). PR onto `dev`, squash-merged.
- `main` is promoted by a PR from `dev`, merge commit, after Kevin QAs `dev`.
- Merging to `dev` or `main` needs Kevin's say in the session.

## Commands

    pnpm install / pnpm dev / pnpm check / pnpm test / pnpm build
