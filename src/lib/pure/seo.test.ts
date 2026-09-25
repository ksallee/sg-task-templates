import { describe, expect, it } from 'vitest';
import { headFor, llmsTxt, pageMeta, sitemapXml, SITE, SITEMAP_PATHS } from './seo';

describe('seo', () => {
	it('gives / and /how their own title and description', () => {
		expect(pageMeta('/').title).toBe('SG Task Templates');
		expect(pageMeta('/how').title).toBe('How it works · SG Task Templates');
		expect(pageMeta('/').description).not.toBe(pageMeta('/how').description);
	});

	it('the flow screens share one description and canonical to their own path', () => {
		expect(pageMeta('/plan').description).toBe(pageMeta('/connect').description);
		expect(pageMeta('/plan').canonical).toBe(`${SITE}/plan`);
		expect(pageMeta('/plan').title).toBe('Plan · SG Task Templates');
	});

	it('an unknown path falls back to the home title and does not index', () => {
		expect(pageMeta('/nope').title).toBe('SG Task Templates');
		expect(headFor('/nope')).toContain('<meta name="robots" content="noindex" />');
		expect(headFor('/')).not.toContain('noindex');
	});

	it('writes canonical, Open Graph, Twitter and theme-color tags', () => {
		const h = headFor('/how');
		expect(h).toContain(`<link rel="canonical" href="${SITE}/how" />`);
		expect(h).toContain(`<meta property="og:url" content="${SITE}/how" />`);
		expect(h).toContain(`<meta property="og:image" content="${SITE}/og.png" />`);
		expect(h).toContain('<meta property="og:image:width" content="1200" />');
		expect(h).toContain('<meta name="twitter:card" content="summary_large_image" />');
		expect(h).toContain('<meta name="theme-color"');
		expect(h).toContain('<title>How it works · SG Task Templates</title>');
	});

	it('escapes attribute values', () => {
		expect(headFor('/')).not.toMatch(/content="[^"]*[<>][^"]*"/);
	});

	it('the sitemap lists / and /how only', () => {
		expect(SITEMAP_PATHS).toEqual(['/', '/how']);
		const xml = sitemapXml();
		expect(xml).toContain(`<loc>${SITE}/</loc>`);
		expect(xml).toContain(`<loc>${SITE}/how</loc>`);
		expect(xml).not.toContain('/plan');
	});

	it('llms.txt names what it does, the rules and the repo', () => {
		const t = llmsTxt();
		expect(t.startsWith('# SG Task Templates\n')).toBe(true);
		expect(t).toContain(`${SITE}/how`);
		expect(t).toContain('https://github.com/ksallee/sg-task-templates');
	});
});
