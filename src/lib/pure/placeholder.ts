/**
 * Placeholder for the pure modules the brief calls for: the planner (template + entity Tasks →
 * plan), matching, the batch builder, the result reader. Each lands here as its own module, no
 * I/O in it, with a colocated `.test.ts` written first (TDD). Delete this file once one exists.
 */
export function identity<T>(value: T): T {
	return value;
}
