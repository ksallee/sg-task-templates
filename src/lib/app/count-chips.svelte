<!-- The five counts in their fixed order, as one row. `counts` may carry more keys; only the five show. -->
<script lang="ts">
	import type { PlanKind } from '$lib/pure/types';
	import { cn } from '$lib/utils.js';
	import CountChip, { KINDS } from './count-chip.svelte';

	let {
		counts,
		compact = false,
		size = 'sm',
		hideZero = false,
		entityType = null,
		class: className
	}: {
		counts: Record<PlanKind, number>;
		compact?: boolean;
		size?: 'xs' | 'sm';
		hideZero?: boolean;
		entityType?: string | null;
		class?: string;
	} = $props();
</script>

<span class={cn('inline-flex flex-wrap items-center gap-1.5', className)} data-slot="count-chips">
	{#each KINDS as kind (kind)}
		{#if !hideZero || counts[kind] > 0}
			<CountChip {kind} count={counts[kind]} {compact} {size} {entityType} />
		{/if}
	{/each}
</span>
