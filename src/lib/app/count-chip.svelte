<!--
	One of the plan's five counts, drawn the same on every screen (docs/design.md): a dot in the
	kind's tone, the word (`$lib/pure/kinds`), the number. Already linked muted, Linked info, Created
	success, Not in template warning, Needs a choice destructive. Zero is dimmed; a conflict above zero outlines in destructive. `compact`
	drops the word for narrow lists and keeps it in the label. `entityType`, a display name, names the
	entity in Created's meaning. No fill of its own (sg-widgets rule 1).
-->
<script lang="ts" module>
	import type { PlanKind } from '$lib/pure/types';
	import { KIND_LABEL, KINDS, kindMeaning } from '$lib/pure/kinds';

	export { KIND_LABEL, KINDS, kindMeaning };

	/** The dot's colour per kind, a token each. */
	export const KIND_DOT: Record<PlanKind, string> = {
		keep: 'bg-muted-foreground',
		claim: 'bg-info',
		create: 'bg-success',
		extra: 'bg-warning',
		conflict: 'bg-destructive'
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		kind,
		count,
		compact = false,
		size = 'sm',
		entityType = null,
		class: className
	}: { kind: PlanKind; count: number; compact?: boolean; size?: 'xs' | 'sm'; entityType?: string | null; class?: string } = $props();

	const zero = $derived(count === 0);
	const loud = $derived(kind === 'conflict' && count > 0);
</script>

<span
	class={cn(
		'inline-flex shrink-0 items-center gap-1 rounded-md border font-medium whitespace-nowrap tabular-nums',
		size === 'xs' ? 'h-5 px-1.5 text-xs' : 'h-6 px-2 text-xs',
		zero ? 'text-muted-foreground border-border/60 opacity-60' : 'border-border text-foreground',
		loud && 'border-destructive/60 text-destructive',
		className
	)}
	title={`${KIND_LABEL[kind]}: ${count}. ${kindMeaning(kind, entityType)}`}
	aria-label={`${KIND_LABEL[kind]} ${count}`}
	data-slot="count-chip"
	data-kind={kind}
	data-zero={zero ? '' : undefined}
>
	<span class={cn('size-2 shrink-0 rounded-full', KIND_DOT[kind], zero && 'opacity-50')} aria-hidden="true"></span>
	{#if !compact}<span>{KIND_LABEL[kind]}</span>{/if}
	<span class={compact ? '' : 'text-muted-foreground'} class:text-destructive={loud}>{count}</span>
</span>
