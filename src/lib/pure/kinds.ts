/**
 * The five plan outcomes in the app's words, for every screen that prints one. Pure, no I/O. Code
 * keeps the identifiers (keep, claim, create, extra, conflict); users read these.
 */
import type { PlanKind } from './types';

export const KINDS: readonly PlanKind[] = ['keep', 'claim', 'create', 'extra', 'conflict'];

export const KIND_LABEL: Record<PlanKind, string> = {
	keep: 'Already linked',
	claim: 'Linked',
	create: 'Created',
	extra: 'Not in template',
	conflict: 'Needs a choice'
};

/** One sentence per outcome. `entityType` (a display name, "Shot") names the entity in Created. */
export function kindMeaning(kind: PlanKind, entityType?: string | null): string {
	switch (kind) {
		case 'keep':
			return 'Linked to this template before the apply.';
		case 'claim':
			return 'Matched by name and Step, linked to the template.';
		case 'create':
			return `Missing on the ${entityType || 'entity'}, created from the template.`;
		case 'extra':
			return 'Not changed unless requested.';
		case 'conflict':
			return 'Several Tasks match one template task.';
	}
}
