<!--
	The plan, always shown before a write: entity list with counts on the left, detail on the right.
	Placeholder until the plan screen lands: the run's totals and the access check, from `run`.
-->
<script lang="ts">
	import { run } from '$lib/app/run.svelte';
	import { planTotals } from '$lib/pure/entry';
	import { Button } from '$lib/components/ui/button/index.js';

	const totals = $derived(planTotals(run.plans));
	const KINDS = ['keep', 'claim', 'create', 'extra', 'conflict'] as const;
</script>

<svelte:head><title>Plan · SG Task Templates</title></svelte:head>

{#if run.plans.length === 0}
	<div class="flex flex-col items-start gap-2 p-6">
		<p class="text-muted-foreground text-sm">No plan yet. Choose the entities, then Next.</p>
		<Button size="sm" href="/entities">Entities</Button>
	</div>
{:else}
	<div class="flex flex-col items-start gap-3 p-6" data-slot="plan-totals">
		<p class="text-sm">
			<span class="font-medium">{run.template?.code}</span> on {totals.entities}
			{totals.entities === 1 ? 'entity' : 'entities'}, {totals.noop} with nothing to write.
		</p>
		<dl class="grid grid-cols-5 gap-4 text-sm">
			{#each KINDS as kind (kind)}
				<div>
					<dt class="text-muted-foreground capitalize">{kind}</dt>
					<dd class="font-mono tabular-nums" data-slot={`count-${kind}`}>{totals[kind]}</dd>
				</div>
			{/each}
		</dl>
		<p class="text-muted-foreground text-sm" data-slot="access">
			{#if run.access.state === 'loading'}
				Checking write access…
			{:else if run.access.state === 'error'}
				The access check failed: {run.access.message}
			{:else if run.access.state === 'ready' && run.access.value === null}
				No Task on these entities to check access on.
			{:else if run.access.state === 'ready' && run.access.value}
				{run.access.value.looksShort ? 'Write access looks short.' : 'Write access looks fine.'}
			{/if}
		</p>
		<p class="text-muted-foreground text-sm">The plan screen comes next.</p>
	</div>
{/if}
