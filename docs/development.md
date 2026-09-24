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
