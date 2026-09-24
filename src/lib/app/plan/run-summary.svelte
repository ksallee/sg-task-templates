<!--
	The answer to "what happens if I click Apply": the run summary's sentences (plan-summary.ts),
	grouped by consequence. Each line filters the entity list to the entities it counts; a second
	click clears it.
-->
<script lang="ts">
	import { GROUP_LABEL, type SummaryGroup, type SummaryKey, type SummaryLine } from '$lib/pure/plan-summary';
	import { TONE_DOT } from './tone';
	import { cn } from '$lib/utils.js';

	let { lines, active, onFilter }: { lines: SummaryLine[]; active: SummaryKey | null; onFilter: (key: SummaryKey | null) => void } = $props();

	const ORDER: SummaryGroup[] = ['attention', 'tasks', 'fields', 'dependencies', 'same'];
	const groups = $derived(ORDER.map((g) => ({ group: g, lines: lines.filter((l) => l.group === g) })).filter((g) => g.lines.length > 0));
</script>

<section class="border-border flex shrink-0 flex-col gap-3 border-b px-6 py-4" data-slot="run-summary" aria-label="What Apply does">
	<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
		<h2 class="text-sm font-semibold">If you apply</h2>
		<span class="text-muted-foreground text-xs">Click a line to list the entities it touches.</span>
	</div>
	<div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-8 gap-y-3">
		{#each groups as g (g.group)}
			<div class="flex flex-col gap-1" data-slot="summary-group" data-group={g.group}>
				<p class="text-muted-foreground text-xs font-medium">{GROUP_LABEL[g.group]}</p>
				<ul class="flex flex-col">
					{#each g.lines as l (l.key)}
						{@const on = active === l.key}
						<li>
							<button
								type="button"
								aria-pressed={on}
								class={cn(
									'-mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded-md px-2 py-1 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
									on ? 'bg-primary/10 ring-primary/40 ring-1' : 'hover:bg-muted',
									l.tone === 'destructive' && l.group === 'attention' && 'text-destructive font-medium'
								)}
								onclick={() => onFilter(on ? null : l.key)}
								data-slot="summary-line"
								data-key={l.key}
							>
								<span class={cn('mt-1.5 size-2 shrink-0 rounded-full', TONE_DOT[l.tone])} aria-hidden="true"></span>
								<span class="min-w-0">
									{l.text}{#if l.where}<span class="text-muted-foreground">, {l.where}</span>{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</section>
