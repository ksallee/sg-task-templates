import { describe, expect, it } from 'vitest';
import { HOW_ANCHORS, HOW_CONCEPTS, HOW_SECTIONS, howHref, type HowConcept } from './how';

describe('how', () => {
	it('lists the sections of /how in page order', () => {
		expect(HOW_SECTIONS.map((s) => s.id)).toEqual([
			'matching',
			'outcomes',
			'fields',
			'extras',
			'dependencies',
			'undo',
			'permissions'
		]);
	});

	it('anchors are unique and every section is one', () => {
		expect(new Set(HOW_ANCHORS).size).toBe(HOW_ANCHORS.length);
		for (const s of HOW_SECTIONS) expect(HOW_ANCHORS).toContain(s.id);
	});

	it('every plan concept points at an anchor the page has', () => {
		for (const concept of Object.keys(HOW_CONCEPTS) as HowConcept[]) {
			expect(HOW_ANCHORS).toContain(HOW_CONCEPTS[concept]);
		}
	});

	it('the five counts point at their own outcome', () => {
		expect(howHref('keep')).toBe('/how#keep');
		expect(howHref('claim')).toBe('/how#claim');
		expect(howHref('create')).toBe('/how#create');
		expect(howHref('extra')).toBe('/how#extra');
		expect(howHref('conflict')).toBe('/how#conflict');
	});

	it('other concepts land on their section', () => {
		expect(howHref('matchKey')).toBe('/how#matching');
		expect(howHref('fieldPolicy')).toBe('/how#fields');
		expect(howHref('extraAction')).toBe('/how#extras');
		expect(howHref('affectedEdge')).toBe('/how#edges-removed');
		expect(howHref('mayMove')).toBe('/how#dates');
		expect(howHref('undo')).toBe('/how#undo');
		expect(howHref('access')).toBe('/how#permissions');
	});
});
