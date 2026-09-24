import { describe, expect, it } from 'vitest';
import { activeSection, HOW_ANCHORS, HOW_CONCEPTS, HOW_SECTIONS, howHref, type HowConcept } from './how';

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

describe('activeSection', () => {
	const tops = (...t: number[]) => HOW_SECTIONS.slice(0, t.length).map((s, i) => ({ id: s.id, top: t[i] }));

	it('is the first section before any heading reaches the line', () => {
		expect(activeSection(tops(200, 800, 1400), 80)).toBe('matching');
	});

	it('is the last section whose heading is at or above the line', () => {
		expect(activeSection(tops(-900, -200, 80, 700), 80)).toBe('fields');
		expect(activeSection(tops(-900, -200, 81, 700), 80)).toBe('outcomes');
	});

	it('is the last section when scrolled to the bottom, even below the line', () => {
		expect(activeSection(tops(-900, -200, 300), 80, true)).toBe('fields');
	});

	it('is null with no sections', () => {
		expect(activeSection([], 80)).toBeNull();
	});
});
