/** Token classes per summary tone (docs/design.md: muted, info, success, warning, destructive). */
import type { Tone } from '$lib/pure/plan-summary';

export const TONE_DOT: Record<Tone, string> = {
	muted: 'bg-muted-foreground',
	info: 'bg-info',
	success: 'bg-success',
	warning: 'bg-warning',
	destructive: 'bg-destructive'
};

export const TONE_TEXT: Record<Tone, string> = {
	muted: 'text-muted-foreground border-border',
	info: 'text-info border-info/50',
	success: 'text-success border-success/50',
	warning: 'text-warning border-warning/60',
	destructive: 'text-destructive border-destructive/60'
};
