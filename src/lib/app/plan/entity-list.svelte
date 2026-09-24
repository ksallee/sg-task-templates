<!--
	The plan's left rail: one row per entity, its five counts as compact CountChips and its warnings.
	Selecting a row shows its detail. Filtering happens in `plan-view.ts` (filterPlans); this only draws.
-->
<script lang="ts">
	import type { EntityPlan, Id, RunOptions } from '$lib/pure/types';
	import { entityWarnings } from '$lib/pure/plan-view';
	import CountChips from '$lib/app/count-chips.svelte';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { cn } from '$lib/utils.js';

	type Props = {
		plans: EntityPlan[];
		options: RunOptions;
		selected: Id | null;
		onSelect: (id: Id) => void;
	};
	let { plans, options, selected, onSelect }: Props = $props();
</script>

<ul class="flex flex-col py-1" data-slot="plan-entity-list">
	{#each plans as plan (plan.entity.id)}
		{@const warnings = entityWarnings(plan, options)}
		{@const blocking = warnings.some((w) => w.level === 'block')}
		{@const on = selected === plan.entity.id}
		<li class="px-2">
			<button
				type="button"
				class={cn(
					'flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
					on ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
				)}
				aria-current={on ? 'true' : undefined}
				onclick={() => onSelect(plan.entity.id)}
				data-slot="plan-entity"
			>
				<span class="flex min-w-0 items-center gap-2">
					<span class={cn('truncate text-sm', on && 'font-medium')}>{plan.entity.name ?? `${plan.entity.type} #${plan.entity.id}`}</span>
					{#if plan.noop}<span class="text-muted-foreground text-xs">no-op</span>{/if}
					<span class="mr-auto"></span>
					{#if warnings.length > 0}
						<span
							class={cn(
								'inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium tabular-nums',
								blocking ? 'border-destructive/60 text-destructive' : 'border-warning/60 text-warning'
							)}
							title={warnings.map((w) => w.text).join('\n')}
							aria-label={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
							data-slot="plan-entity-warnings"
						>
							{#if blocking}<CircleAlert class="size-3" aria-hidden="true" />{:else}<TriangleAlert class="size-3" aria-hidden="true" />{/if}
							{warnings.length}
						</span>
					{/if}
				</span>
				<CountChips counts={plan.counts} compact size="xs" class="gap-1" />
			</button>
		</li>
	{:else}
		<li class="text-muted-foreground px-4 py-3 text-sm">No entity matches the filter.</li>
	{/each}
</ul>
