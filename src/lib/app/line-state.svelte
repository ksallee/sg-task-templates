<!--
	One entity's state on the apply and result screens, drawn as the CountChip (docs/design.md): a
	dot in the state's tone, the word, and a count when it tallies a run. No fill of its own
	(sg-widgets rule 1). Landing pulses; failed and differences above zero outline in their tone.
-->
<script lang="ts" module>
	import type { LineState } from '$lib/pure/apply-view';
	import type { ResultKind } from '$lib/pure/result-view';

	export type AnyLineState = LineState | ResultKind;

	export const STATE_LABEL: Record<AnyLineState, string> = {
		pending: 'Pending',
		landing: 'Landing',
		landed: 'Landed',
		failed: 'Failed',
		cancelled: 'Cancelled',
		undone: 'Undone',
		clean: 'Landed clean',
		differences: 'With differences',
		not_applied: 'Not applied'
	};

	const DOT: Record<AnyLineState, string> = {
		pending: 'bg-muted-foreground/60',
		landing: 'bg-info motion-safe:animate-pulse',
		landed: 'bg-success',
		clean: 'bg-success',
		differences: 'bg-warning',
		failed: 'bg-destructive',
		cancelled: 'bg-muted-foreground/60',
		not_applied: 'bg-muted-foreground/60',
		undone: 'bg-info'
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';

	let { state, count, label, class: className }: { state: AnyLineState; count?: number; label?: string; class?: string } = $props();

	const zero = $derived(count === 0);
	const loud = $derived(count !== 0 && (state === 'failed' || state === 'differences'));
	const quiet = $derived(state === 'pending' || state === 'cancelled' || state === 'not_applied');
</script>

<span
	class={cn(
		'inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium whitespace-nowrap tabular-nums',
		zero ? 'border-border/60 text-muted-foreground opacity-60' : quiet ? 'border-border text-muted-foreground' : 'border-border text-foreground',
		loud && state === 'failed' && 'border-destructive/60 text-destructive',
		loud && state === 'differences' && 'border-warning/70',
		className
	)}
	data-slot="line-state"
	data-state={state}
>
	<span class={cn('size-2 shrink-0 rounded-full', DOT[state], zero && 'opacity-50')} aria-hidden="true"></span>
	<span>{label ?? STATE_LABEL[state]}</span>
	{#if count !== undefined}<span class={loud && state === 'failed' ? '' : 'text-muted-foreground'}>{count}</span>{/if}
</span>
