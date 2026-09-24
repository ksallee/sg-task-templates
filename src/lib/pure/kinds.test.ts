import { describe, expect, it } from 'vitest';
import { KIND_LABEL, kindMeaning } from './kinds';

describe('kinds', () => {
	it('names the five outcomes in the app’s words', () => {
		expect(KIND_LABEL).toEqual({
			keep: 'Already linked',
			claim: 'Linked',
			create: 'Created',
			extra: 'Not in template',
			conflict: 'Needs a choice'
		});
	});

	it('says what each means in one sentence', () => {
		expect(kindMeaning('keep')).toBe('Linked to this template before the apply.');
		expect(kindMeaning('claim')).toBe('Matched by name and Step, linked to the template.');
		expect(kindMeaning('extra')).toBe('Not changed unless requested.');
		expect(kindMeaning('conflict')).toBe('Several Tasks match one template task.');
	});

	it('names the entity type in Created when it is known, else "entity"', () => {
		expect(kindMeaning('create', 'Shot')).toBe('Missing on the Shot, created from the template.');
		expect(kindMeaning('create', 'CustomEntity01')).toBe('Missing on the CustomEntity01, created from the template.');
		expect(kindMeaning('create')).toBe('Missing on the entity, created from the template.');
		expect(kindMeaning('create', null)).toBe('Missing on the entity, created from the template.');
	});
});
