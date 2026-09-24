/**
 * The /how page's anchors, and which one explains each plan concept. Pure, no I/O. `/how` renders
 * its sections from `HOW_SECTIONS` and its sub-anchors from `HOW_ANCHORS`; a screen links a concept
 * with `howHref` (or `$lib/app/how-link.svelte`), so the two cannot drift.
 */

export const HOW_SECTIONS = [
	{ id: 'matching', title: 'Matching' },
	{ id: 'outcomes', title: 'The five outcomes' },
	{ id: 'fields', title: 'Fields' },
	{ id: 'extras', title: 'Tasks not in the template' },
	{ id: 'dependencies', title: 'Dependencies and dates' },
	{ id: 'undo', title: 'Undo' },
	{ id: 'permissions', title: 'Permissions' }
] as const;

export type HowSectionId = (typeof HOW_SECTIONS)[number]['id'];

/** Anchors inside a section: one per outcome, and the two halves of dependencies. */
const SUB_ANCHORS = ['keep', 'claim', 'create', 'extra', 'conflict', 'edges-removed', 'dates'] as const;

export type HowAnchor = HowSectionId | (typeof SUB_ANCHORS)[number];

export const HOW_ANCHORS: readonly HowAnchor[] = [...HOW_SECTIONS.map((s) => s.id), ...SUB_ANCHORS];

/** A concept a screen may want to explain, and the anchor that does. */
export const HOW_CONCEPTS = {
	keep: 'keep',
	claim: 'claim',
	create: 'create',
	extra: 'extra',
	conflict: 'conflict',
	matchKey: 'matching',
	fieldPolicy: 'fields',
	extraAction: 'extras',
	affectedEdge: 'edges-removed',
	mayMove: 'dates',
	undo: 'undo',
	access: 'permissions'
} as const satisfies Record<string, HowAnchor>;

export type HowConcept = keyof typeof HOW_CONCEPTS;

export function howHref(concept: HowConcept): string {
	return `/how#${HOW_CONCEPTS[concept]}`;
}

/**
 * The section the reader is in, for the side nav: the last one whose heading has reached `line`
 * (px from the top of the scroll pane), the first before any has. `atEnd` (scrolled to the bottom)
 * picks the last section, which may be too short to reach the line.
 */
export function activeSection(
	tops: ReadonlyArray<{ id: HowSectionId; top: number }>,
	line: number,
	atEnd = false
): HowSectionId | null {
	if (tops.length === 0) return null;
	if (atEnd) return tops[tops.length - 1].id;
	let current = tops[0].id;
	for (const t of tops) if (t.top <= line) current = t.id;
	return current;
}
