<!--
	A Task's outcome on the plan (plan-summary.ts): a dot in its tone, the label, an optional count.
	Bordered, no fill (sg-widgets rule 1).
-->
<script lang="ts" module>
	import type { TaskOutcome, Tone } from '$lib/pure/plan-summary';

	export const OUTCOME_TONE: Record<TaskOutcome, Tone> = {
		needs_choice: 'destructive',
		deleted: 'destructive',
		omitted: 'warning',
		linked_renamed: 'info',
		linked: 'info',
		created: 'success',
		updated: 'info',
		left: 'muted',
		unchanged: 'muted'
	};
</script>

<script lang="ts">
	import { OUTCOME_LABEL, outcomeMeaning } from '$lib/pure/plan-summary';
	import { TONE_DOT } from './tone';
	import { cn } from '$lib/utils.js';

	let {
		outcome,
		count,
		entityType = null,
		class: className
	}: { outcome: TaskOutcome; count?: number; entityType?: string | null; class?: string } = $props();
	const tone = $derived(OUTCOME_TONE[outcome]);
</script>

<span
	class={cn(
		'inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
		tone === 'destructive' ? 'border-destructive/60 text-destructive' : 'border-border text-foreground',
		className
	)}
	title={outcomeMeaning(outcome, entityType)}
	data-slot="outcome-chip"
	data-outcome={outcome}
>
	<span class={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden="true"></span>
	{OUTCOME_LABEL[outcome]}
	{#if count !== undefined}<span class="text-muted-foreground tabular-nums">{count}</span>{/if}
</span>
