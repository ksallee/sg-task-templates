import { describe, expect, it } from 'vitest';
import { localTime } from './time';

describe('localTime', () => {
	it('prints an ISO instant in the browser time zone, to the minute', () => {
		const iso = new Date(2026, 8, 25, 16, 45, 30).toISOString();
		expect(localTime(iso)).toBe('2026-09-25 16:45');
	});

	it('pads months, days, hours and minutes', () => {
		expect(localTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe('2026-01-02 03:04');
	});

	it('leaves anything else as it is', () => {
		expect(localTime('not a date')).toBe('not a date');
	});
});
