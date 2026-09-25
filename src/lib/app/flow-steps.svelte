<!--
	The step indicator (docs/design.md): Connect → Template → Entities → Plan → Apply → Result,
	numbered. Current: primary ring. Done: a check, still a link. Open: a link. Blocked: dimmed, not
	a link, the reason in its title. The states come from `$lib/pure/flow.ts`. Below sm the chevrons
	go and the numbers tighten, so six steps fit a phone. Labels from lg; the site from xl, so the two never meet.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { FlowStep } from '$lib/pure/flow';
	import { cn } from '$lib/utils.js';

	let { steps }: { steps: FlowStep[] } = $props();
</script>

<nav class="flex min-w-0 items-center" aria-label="Steps" data-slot="flow-steps">
	<ol class="flex min-w-0 items-center gap-0.5">
		{#each steps as step, i (step.id)}
			<li class="flex items-center gap-0.5">
				{#if i > 0}<ChevronRight class="text-muted-foreground/50 hidden size-3.5 shrink-0 sm:block" aria-hidden="true" />{/if}
				{#snippet body()}
					<span
						class={cn(
							'flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] leading-none font-semibold tabular-nums',
							step.state === 'current' && 'border-primary bg-primary text-primary-foreground',
							step.state === 'done' && 'border-border bg-muted text-foreground',
							(step.state === 'open' || step.state === 'blocked') && 'border-border text-muted-foreground'
						)}
						aria-hidden="true"
					>
						{#if step.state === 'done'}<Check class="size-3" />{:else}{i + 1}{/if}
					</span>
					<span class="hidden lg:inline">{step.label}</span>
				{/snippet}
				{#if step.state === 'blocked'}
					<span
						class="text-muted-foreground flex h-7 cursor-not-allowed items-center gap-1.5 rounded-md px-1 text-sm opacity-50 sm:px-1.5"
						title={step.hint ?? undefined}
						aria-disabled="true"
						data-state={step.state}
					>
						{@render body()}
						<span class="sr-only">(blocked: {step.hint})</span>
					</span>
				{:else}
					<a
						href={step.href}
						class={cn(
							'focus-visible:ring-ring flex h-7 items-center gap-1.5 rounded-md px-1 text-sm outline-none sm:px-1.5 transition-colors duration-150 focus-visible:ring-2',
							step.state === 'current' ? 'text-foreground font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
						)}
						aria-current={step.state === 'current' ? 'step' : undefined}
						title={step.label}
						data-state={step.state}
					>
						{@render body()}
					</a>
				{/if}
			</li>
		{/each}
	</ol>
</nav>
