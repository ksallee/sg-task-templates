<!--
	/how's tiny picture of one outcome: the entity's Task(s) on the left, the template task on the
	right, the link between. Keep: linked already. Claim: the link is written. Create: a new Task.
	Extra: no template task. Conflict: two Tasks for one template task. Tones as the count chips.
-->
<script lang="ts">
	import type { PlanKind } from '$lib/pure/types';

	let { kind }: { kind: PlanKind } = $props();

	const TONE: Record<PlanKind, string> = {
		keep: 'text-muted-foreground',
		claim: 'text-info',
		create: 'text-success',
		extra: 'text-warning',
		conflict: 'text-destructive'
	};
</script>

<svg viewBox="0 0 64 28" class="h-8 w-[4.5rem] shrink-0 {TONE[kind]}" aria-hidden="true" focusable="false">
	<!-- the template task, right -->
	{#if kind === 'extra'}
		<rect x="44" y="9" width="16" height="10" rx="2.5" class="text-muted-foreground" fill="none" stroke="currentColor" stroke-opacity="0.6" stroke-dasharray="2 2" />
	{:else}
		<rect x="44" y="9" width="16" height="10" rx="2.5" class="fill-muted-foreground/25 text-muted-foreground" stroke="currentColor" stroke-opacity="0.5" />
	{/if}

	{#if kind === 'conflict'}
		<rect x="4" y="2" width="16" height="10" rx="2.5" fill="currentColor" />
		<rect x="4" y="16" width="16" height="10" rx="2.5" fill="currentColor" />
		<path d="M20 7 L44 14 M20 21 L44 14" stroke="currentColor" stroke-width="1.5" fill="none" />
	{:else if kind === 'create'}
		<rect x="4" y="9" width="16" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 2" />
		<path d="M20 14 H44" stroke="currentColor" stroke-width="1.5" />
		<path d="M12 11.5 v5 M9.5 14 h5" stroke="currentColor" stroke-width="1.25" />
	{:else if kind === 'extra'}
		<rect x="4" y="9" width="16" height="10" rx="2.5" fill="currentColor" />
	{:else}
		<rect x="4" y="9" width="16" height="10" rx="2.5" fill="currentColor" />
		<path d="M20 14 H44" stroke="currentColor" stroke-width="1.5" stroke-dasharray={kind === 'claim' ? '3 2' : undefined} />
	{/if}
</svg>
