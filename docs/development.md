# Working on sg-task-templates

## Run it

    pnpm install
    pnpm dev

Open the URL Vite prints, name the site and sign in through the App Session Launcher. With
`.env.local` holding `FPT_API_SITE_URL`, `FPT_API_SCRIPT_NAME` and `FPT_API_API_KEY` (see
`.env.example`), `pnpm dev` reads through the script key and no sign-in is needed. A production
build ignores those and always signs in.

    pnpm check
    pnpm test
    pnpm build
    uv run --no-project --python 3.11 --with pytest pytest tools -q

`.github/workflows/gates.yml` runs those four on every pull request and on pushes to `dev` and
`main`. The last one tests the seed planner.

## Ports

`pnpm dev` takes Vite's default, 5173. Anything else that runs beside it (a second worktree, an
agent's headless drive) takes its own port from 5191 up, one each:

    pnpm dev --port 5205 --strictPort

`--strictPort` makes Vite stop when the port is taken, so a drive never lands on another checkout's
server.

## Against the seeded sandbox

`tools/seed.py` seeds the scenarios into the sandbox project named by `FPT_PROBE_SANDBOX_PROJECT`
in `../sg-groundtruth/.env.local`, and records what it made in `fixtures/seed-manifest.json`. The
manifest's `project` is the id to pick (1180 today); its `templates` are the `TT Seed · ` templates
(T1 to T6) and its `scenarios` the `tts_` entities, one scenario per code.

    uv run --no-project --python 3.11 --with requests python tools/seed.py

A dry run: it reports each scenario as missing, pristine, drifted or orphan, and writes nothing. A
drifted scenario lists every drifted entity, one line each, with a count per kind.

    uv run --no-project --python 3.11 --with requests python tools/seed.py --write
    uv run --no-project --python 3.11 --with requests python tools/seed.py --reset S04,S13,BULK

`--write` creates what is missing. `--reset` takes scenario ids, comma-separated, or `all`: it
deletes those scenarios and recreates them, after an apply. It writes on its own, no `--write`
needed. It rewrites `fixtures/seed-manifest.json`: commit it. The docstring at the top of
`tools/seed.py` lists the rest.

1. Point the dev token route at the same site. `.env.local` at the repo root (gitignored) takes the
   three `FPT_API_*` lines from `../sg-groundtruth/.env.local`:

       grep '^FPT_API_' ../sg-groundtruth/.env.local > .env.local

   `POST /live/dev-token` then mints a 600 s bearer from that script key under `vite dev` only, and
   the page reads without a sign-in. Signing in through the launcher over it writes as yourself.
2. `pnpm dev`, open the URL, go to Template. Pick the project (search its name), the entity
   type (only types a Task links to and with a `task_template` field are offered, as the
   site's `Task.entity` lists them), then a template: its tasks and dependencies show on the right. The project's default
   for the type (088; Kevin sets Shot = T2 and Asset = T4 in the project's Tracking Settings) is
   tagged Project default and pre-selected.
3. Next: entities. One list, filtered by template: All, Using this template, Other template or No
   template. It opens on Using this template when an entity uses it, else All. Nothing is
   pre-selected. Filter by code, every word required (`tts bulk` for the seeded bulk Shots), select,
   then Plan. It reads the entities in batches of 25 and plans them.
4. The plan shows at once. The access check (probe 094: refused or rolled-back calls only, nothing
   lands) runs beside it, and Apply waits on it.

Nothing up to the plan writes. Apply opens a confirm dialog; its button is the first write.

## Deploy

From `main` alone. `vercel.json` names SvelteKit as the framework, enables `main` under
`git.deploymentEnabled`, and skips every other ref in `ignoreCommand` off `VERCEL_GIT_COMMIT_REF`,
so a feature branch never builds a preview. `src/lib/deploy.test.ts` holds it to that. The build is
`@sveltejs/adapter-vercel`: the page is a client-rendered shell (`ssr = false`) and the routes under
`/live/` are serverless functions.

Set in the Vercel project, value never in the repo:

| var | what it does deployed |
|---|---|
| `PUBLIC_FPT_SITE_URL` | the site the sign-in form offers by default. The only variable the deployment has. |

`FPT_API_SITE_URL`, `FPT_API_SCRIPT_NAME` and `FPT_API_API_KEY` are dev only, in `.env.local`. Never
set them on Vercel. The deployed build answers `/live/dev-token` 404 before it reads them.
