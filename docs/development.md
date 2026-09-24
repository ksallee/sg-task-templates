# Working on sg-task-templates

## Run it

    pnpm install
    pnpm dev

Open the URL Vite prints, name the site and sign in through the App Session Launcher. With
`.env.local` holding `FPT_API_SITE_URL`, `FPT_API_SCRIPT_NAME` and `FPT_API_API_KEY` (see
`.env.example`), `pnpm dev` reads through the script key and no sign-in is needed; a production
build ignores those and always signs in.

    pnpm check
    pnpm test
    pnpm build

`.github/workflows/gates.yml` runs those three, and the seed planner's `uv run --with pytest pytest tools -q`, on every pull request and on pushes to `dev` and `main`.

## Against the seeded sandbox

`tools/seed.py` seeds the scenarios into the sandbox project named by `FPT_PROBE_SANDBOX_PROJECT`
in `../sg-groundtruth/.env.local`, and records what it made in `fixtures/seed-manifest.json`. The
manifest's `project` is the id to pick (1180 today); its `templates` are the `TT Seed · ` templates
(T1 to T6) and its `scenarios` the `tts_` entities, one scenario per code.

1. Point the dev token route at the same site. `.env.local` at the repo root (gitignored) takes the
   three `FPT_API_*` lines from `../sg-groundtruth/.env.local`:

       grep '^FPT_API_' ../sg-groundtruth/.env.local > .env.local

   `POST /live/dev-token` then mints a 600 s bearer from that script key under `vite dev` only, and
   the page reads without a sign-in. Signing in through the launcher over it writes as yourself.
2. `pnpm dev`, open the URL, go to Template. Pick the project (search its name or type `1180`'s
   name), the entity type (Shot, Asset or Sequence: only types with a `task_template` field are
   offered; the list is read once per browser session, about one schema read per site type), then
   a template: the tasks and dependencies show on the right.
3. Choose the entities: every entity using the template, pick from all of the type, or those with
   no template (the project's default for the type is pre-selected, 088; Kevin sets Shot = T2 and
   Asset = T4 in the project's Tracking Settings). Filter by code (`tts_` for the seeded ones),
   select, then Next. Next reads the entities in batches of 25, plans them and runs the access check
   (probe 094: refused or rolled-back calls only, nothing lands). The plan screen shows the counts.

Nothing up to the plan writes. `uv run --with requests python tools/seed.py` (a dry run) reports
which scenarios are still pristine; `--reset S04` puts one back after an apply.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand` off `VERCEL_GIT_COMMIT_REF`,
so a feature branch never builds a preview. `src/lib/deploy.test.ts` holds it to that. The build is
`@sveltejs/adapter-vercel`: the page is a client-rendered shell (`ssr = false`) and the routes under
`/live/` are serverless functions.

Set in the Vercel project, values never in the repo:

| var | what it does deployed |
|---|---|
| `PUBLIC_FPT_SITE_URL` | the site the sign-in form offers by default. The only one the deployed page reads. |
| `FPT_API_SITE_URL`, `FPT_API_SCRIPT_NAME`, `FPT_API_API_KEY` | the script key `/live/dev-token` mints a bearer from. Read under `vite dev` only: the deployed build answers that route 404 before it looks at them, so a public deployment has no reason to carry the key. |
