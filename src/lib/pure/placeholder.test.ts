import { describe, expect, it } from 'vitest';
import { identity } from './placeholder';

describe('identity', () => {
	it('returns what it is given, proving the vitest harness runs', () => {
		expect(identity(7)).toBe(7);
	});
});
