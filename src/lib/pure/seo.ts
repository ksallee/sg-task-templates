/**
 * What a crawler and a link preview read. The app renders in the browser only (`+layout.ts`:
 * `ssr = false`), so `src/hooks.server.ts` writes these tags into the shell per path;
 * `static/robots.txt`, `/sitemap.xml` and `/llms.txt` come from here too.
 */

export const SITE = 'https://sg-task-templates.vercel.app';
export const REPO = 'https://github.com/ksallee/sg-task-templates';
const NAME = 'SG Task Templates';
const LINE = 'Apply a Task Template to Shots that already have Tasks.';

export type PageMeta = { title: string; description: string; canonical: string; index: boolean };

const HOME = `${LINE} Tasks are matched by name and Pipeline Step. Only missing Tasks are created.`;
const HOW =
	'The rules: how Tasks are matched, what is created, which fields are set, dependencies, undo and permissions.';
const FLOW = `${LINE} Sign in to your Flow PT site, see the plan, then apply.`;

const FLOW_TITLES: Record<string, string> = {
	'/connect': 'Connect',
	'/template': 'Template',
	'/entities': 'Entities',
	'/plan': 'Plan',
	'/apply': 'Apply',
	'/result': 'Result'
};

/** The paths worth a search result. The flow screens need a session. */
export const SITEMAP_PATHS = ['/', '/how'];

export function pageMeta(path: string): PageMeta {
	const canonical = `${SITE}${path}`;
	if (path === '/') return { title: NAME, description: HOME, canonical, index: true };
	if (path === '/how') return { title: `How it works · ${NAME}`, description: HOW, canonical, index: true };
	const step = FLOW_TITLES[path];
	if (step) return { title: `${step} · ${NAME}`, description: FLOW, canonical, index: true };
	return { title: NAME, description: HOME, canonical: `${SITE}/`, index: false };
}

const esc = (s: string): string =>
	s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The head tags for a path. Each page's `<svelte:head>` title then keeps `document.title` in step. */
export function headFor(path: string): string {
	const m = pageMeta(path);
	const t = esc(m.title);
	const d = esc(m.description);
	const img = `${SITE}/og.png`;
	const alt = esc(`${NAME}: ${LINE}`);
	return [
		`<title>${t}</title>`,
		`<meta name="description" content="${d}" />`,
		m.index ? '' : '<meta name="robots" content="noindex" />',
		`<link rel="canonical" href="${m.canonical}" />`,
		`<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f5f5f5" />`,
		`<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1a1f25" />`,
		`<meta property="og:type" content="website" />`,
		`<meta property="og:site_name" content="${NAME}" />`,
		`<meta property="og:title" content="${t}" />`,
		`<meta property="og:description" content="${d}" />`,
		`<meta property="og:url" content="${m.canonical}" />`,
		`<meta property="og:image" content="${img}" />`,
		`<meta property="og:image:width" content="1200" />`,
		`<meta property="og:image:height" content="630" />`,
		`<meta property="og:image:alt" content="${alt}" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
		`<meta name="twitter:title" content="${t}" />`,
		`<meta name="twitter:description" content="${d}" />`,
		`<meta name="twitter:image" content="${img}" />`
	]
		.filter(Boolean)
		.join('\n\t\t');
}

export function sitemapXml(): string {
	const urls = SITEMAP_PATHS.map((p) => `\t<url><loc>${SITE}${p}</loc></url>`).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function llmsTxt(): string {
	return `# ${NAME}

> ${LINE} A web app for Flow PT (formerly ShotGrid). Tasks are matched by name and Pipeline Step; only missing Tasks are created. Nothing is written before you see the plan.

## Pages

- [Home](${SITE}/): what it does, the six steps, what it never does.
- [How it works](${SITE}/how): the rules. Matching, outcomes, fields, Tasks not in the template, dependencies, undo, permissions.

## Flow

Connect (your Flow PT site, signed in as yourself), Template, Entities, Plan, Apply, Result. Each entity is applied separately; a failure stops that entity only. Undo is kept per run.

## Source

- [Repository](${REPO})
`;
}
