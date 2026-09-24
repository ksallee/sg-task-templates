<!--
	The plan's left rail: one row per entity, its name and one outcome line ("3 linked, 8 created,
	1 needs a choice", plan-summary.ts), plus an icon when it needs a choice or carries a warning.
	Selecting a row shows its Tasks. Filtering happens on the page (matchesKey); this only draws.
-->
<script lang="ts">
	import type { EntityPlan, Id, RunOptions } from '$lib/pure/types';
	import type { EntitySummary } from '$lib/pure/plan-summary';
	import { entityWarnings } from '$lib/pure/plan-view';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { cn } from '$lib/utils.js';

	type Props = {
		plans: EntityPlan[];
		summaries: Record<Id, EntitySummary>;
		options: RunOptions;
		selected: Id | null;
		onSelect: (id: Id) => void;
	};
	let { plans, summaries, options, selected, onSelect }: Props = $props();
</script>

<ul class="flex flex-col py-1" data-slot="plan-entity-list">
	{#each plans as plan (plan.entity.id)}
		{@const warnings = entityWarnings(plan, options)}
		{@const blocking = warnings.some((w) => w.level === 'block')}
		{@const summary = summaries[plan.entity.id]}
		{@const on = selected === plan.entity.id}
		<li class="px-2">
			<button
				type="button"
				class={cn(
					'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
					on ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
				)}
				aria-current={on ? 'true' : undefined}
				onclick={() => onSelect(plan.entity.id)}
				data-slot="plan-entity"
			>
				<span class="flex min-w-0 items-center gap-2">
					<span class={cn('truncate text-sm', on && 'font-medium')}>{plan.entity.name ?? `${plan.entity.type} #${plan.entity.id}`}</span>
					<span class="mr-auto"></span>
					{#if warnings.length > 0}
						<span class="shrink-0" title={warnings.map((w) => w.text).join('\n')} data-slot="plan-entity-warnings">
							{#if blocking}
								<CircleAlert class="text-destructive size-3.5" aria-label="needs you" />
							{:else}
								<TriangleAlert class="text-warning size-3.5" aria-label={`${warnings.length} warning${warnings.length === 1 ? '' : 's'}`} />
							{/if}
						</span>
					{/if}
				</span>
				<span
					class={cn('text-xs text-pretty', blocking ? 'text-foreground' : 'text-muted-foreground')}
					data-slot="plan-entity-line">{summary?.line ?? ''}</span
				>
			</button>
		</li>
	{:else}
		<li class="text-muted-foreground px-4 py-3 text-sm">No entity matches the filter.</li>
	{/each}
</ul>
