<!--
	The plan's left pane: one row per entity, its five counts and a warnings badge. Selecting a row
	shows its detail. Filtering happens in `plan-view.ts` (filterPlans); this only draws.
-->
<script lang="ts">
	import type { EntityPlan, Id, RunOptions } from '$lib/pure/types';
	import { PLAN_KINDS, entityWarnings } from '$lib/pure/plan-view';

	type Props = {
		plans: EntityPlan[];
		options: RunOptions;
		selected: Id | null;
		onSelect: (id: Id) => void;
	};
	let { plans, options, selected, onSelect }: Props = $props();

	const ABBR: Record<string, string> = { keep: 'kp', claim: 'cl', create: 'cr', extra: 'ex', conflict: 'cf' };
	const TONE: Record<string, string> = {
		keep: 'text-muted-foreground',
		claim: 'text-info',
		create: 'text-success',
		extra: 'text-warning',
		conflict: 'text-destructive'
	};
</script>

<ul class="flex flex-col" data-slot="plan-entity-list">
	{#each plans as plan (plan.entity.id)}
		{@const warnings = entityWarnings(plan, options)}
		{@const blocking = warnings.some((w) => w.level === 'block')}
		<li>
			<button
				type="button"
				class={[
					'border-border flex w-full flex-col gap-1 border-b px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring',
					selected === plan.entity.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
				].join(' ')}
				aria-current={selected === plan.entity.id ? 'true' : undefined}
				onclick={() => onSelect(plan.entity.id)}
				data-slot="plan-entity"
			>
				<span class="flex items-center gap-2">
					<span class="truncate text-sm font-medium">{plan.entity.name ?? `${plan.entity.type} #${plan.entity.id}`}</span>
					{#if plan.noop}<span class="text-muted-foreground text-xs">no-op</span>{/if}
					<span class="mr-auto"></span>
					{#if warnings.length > 0}
						<span
							class={[
								'rounded-full px-1.5 text-xs tabular-nums',
								blocking ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'
							].join(' ')}
							title={warnings.map((w) => w.text).join('\n')}
							data-slot="plan-entity-warnings">{warnings.length} ⚠</span
						>
					{/if}
				</span>
				<span class="flex gap-3 font-mono text-xs tabular-nums">
					{#each PLAN_KINDS as kind (kind)}
						<span class={plan.counts[kind] > 0 ? TONE[kind] : 'text-muted-foreground/50'} title={kind}>
							{ABBR[kind]}&nbsp;{plan.counts[kind]}
						</span>
					{/each}
				</span>
			</button>
		</li>
	{:else}
		<li class="text-muted-foreground p-3 text-sm">No entity matches the filter.</li>
	{/each}
</ul>
