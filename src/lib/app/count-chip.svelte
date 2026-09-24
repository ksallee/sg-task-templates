<!--
	One of the plan's five counts, drawn the same on every screen (docs/design.md): a dot in the
	kind's tone, the word, the number. Keep muted, claim info, create success, extra warning,
	conflict destructive. Zero is dimmed; a conflict above zero outlines in destructive. `compact`
	drops the word for narrow lists and keeps it in the label. No fill of its own (sg-widgets rule 1).
-->
<script lang="ts" module>
	import type { PlanKind } from '$lib/pure/types';

	export const KINDS: readonly PlanKind[] = ['keep', 'claim', 'create', 'extra', 'conflict'];

	export const KIND_LABEL: Record<PlanKind, string> = {
		keep: 'Keep',
		claim: 'Claim',
		create: 'Create',
		extra: 'Extra',
		conflict: 'Conflict'
	};

	/** One line each, for a title or a legend. */
	export const KIND_MEANING: Record<PlanKind, string> = {
		keep: 'Already linked to this template’s task; nothing to link.',
		claim: 'Same name and step; the link to the template task is written.',
		create: 'Missing; the apply creates it.',
		extra: 'On the entity, not in the template; left unless you say otherwise.',
		conflict: 'Two candidates for one template task; you pick.'
	};

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
		class: className
	}: { kind: PlanKind; count: number; compact?: boolean; size?: 'xs' | 'sm'; class?: string } = $props();

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
	title={`${KIND_LABEL[kind]}: ${count}. ${KIND_MEANING[kind]}`}
	aria-label={`${KIND_LABEL[kind]} ${count}`}
	data-slot="count-chip"
	data-kind={kind}
	data-zero={zero ? '' : undefined}
>
	<span class={cn('size-2 shrink-0 rounded-full', KIND_DOT[kind], zero && 'opacity-50')} aria-hidden="true"></span>
	{#if !compact}<span>{KIND_LABEL[kind]}</span>{/if}
	<span class={compact ? '' : 'text-muted-foreground'} class:text-destructive={loud}>{count}</span>
</span>
