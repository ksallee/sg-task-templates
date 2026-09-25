<!--
	One entity's card on the result grid (result-blocks.ts): its name, state and menu (Undo); its
	Task counts in one line; the error with Retry or the differences inline; its Tasks by Pipeline
	Step (the Step on the left of its lines), one dense line each (outcome dot, name, note, label; kinds.ts). Failed and with differences
	outline the card in their tone.
-->
<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import { KIND_DOT } from '$lib/app/count-chip.svelte';
	import LineState from '$lib/app/line-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import { kindMeaning } from '$lib/pure/kinds';
	import type { ResultBlock } from '$lib/pure/result-blocks';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { cn } from '$lib/utils.js';

	let {
		block,
		entityType = null,
		busy = false,
		onretry,
		onundo
	}: {
		block: ResultBlock;
		entityType?: string | null;
		/** A run or an undo in flight: the actions wait. */
		busy?: boolean;
		onretry: () => void;
		onundo: () => void;
	} = $props();

	const STATE_WORD: Partial<Record<ResultBlock['kind'], string>> = {
		clean: 'Applied',
		differences: 'With differences',
		landed: 'Applied earlier'
	};
	const TONE: Partial<Record<ResultBlock['kind'], string>> = {
		failed: 'border-destructive/50',
		differences: 'border-warning/70'
	};
	const entity = $derived(entityType ?? 'entity');
</script>

{#snippet retry()}
	<Button size="sm" variant="outline" onclick={onretry} disabled={busy}>Retry</Button>
{/snippet}

<section
	class={cn('bg-card text-card-foreground flex min-w-0 flex-col gap-3 rounded-lg border p-4', TONE[block.kind])}
	data-slot="result-block"
	data-kind={block.kind}
>
	<header class="flex min-w-0 flex-col gap-1">
		<div class="flex min-h-7 min-w-0 items-center gap-2">
			<h2 class="min-w-0 truncate text-sm font-semibold" title={block.label}>{block.label}</h2>
			<LineState state={block.kind} label={STATE_WORD[block.kind]} class="h-5 px-1.5" />
			{#if block.canUndo}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} size="icon-sm" variant="ghost" class="-mr-1.5 ml-auto" aria-label={`Actions for ${block.label}`}>
								<Ellipsis />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="min-w-44">
						<DropdownMenu.Item variant="destructive" disabled={busy} onSelect={onundo}>
							<RotateCcw /> Undo this {entity}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
		{#if block.counts.length}
			<p class="text-muted-foreground flex flex-wrap gap-x-3 text-xs tabular-nums" data-slot="block-counts">
				{#each block.counts as c (c.kind)}
					<span class="inline-flex items-center gap-1.5 whitespace-nowrap" title={kindMeaning(c.kind, entityType)}>
						<span class="size-1.5 shrink-0 rounded-full {KIND_DOT[c.kind]}" aria-hidden="true"></span>{c.text}
					</span>
				{/each}
			</p>
		{:else if block.tally}
			<p class="text-muted-foreground text-xs">{block.tally}. Applied in an earlier session.</p>
		{:else if block.kind === 'undone'}
			<p class="text-muted-foreground text-xs">Back to its state before the apply.</p>
		{:else if block.kind === 'not_applied'}
			<p class="text-muted-foreground text-xs">The run stopped before this {entity}.</p>
		{:else if block.kind === 'landing'}
			<p class="text-muted-foreground text-xs">Applying.</p>
		{/if}
	</header>

	{#if block.error}
		<Notice tone="destructive" class="px-2.5 py-1.5 text-xs" data-slot="block-error" action={block.canRetry ? retry : undefined}>
			{block.error}
		</Notice>
	{:else if block.canRetry}
		<div>{@render retry()}</div>
	{/if}
	{#if block.differences.length}
		<div class="border-warning/60 bg-warning/10 flex flex-col gap-1 rounded-md border px-2.5 py-1.5 text-xs" data-slot="block-differences">
			<p class="font-medium">Differs from the plan</p>
			<ul class="marker:text-muted-foreground flex list-disc flex-col gap-0.5 pl-4">
				{#each block.differences as text, i (i)}<li>{text}</li>{/each}
			</ul>
		</div>
	{/if}

	{#if block.steps.length}
		<div class="divide-border/60 flex flex-col divide-y" data-slot="block-steps">
			{#each block.steps as group (group.step)}
				<div class="flex min-w-0 gap-3 py-0.5">
					<h3 class="text-muted-foreground w-20 shrink-0 truncate text-xs leading-6 font-medium" title={group.step}>{group.step}</h3>
					<ul class="flex min-w-0 flex-1 flex-col">
						{#each group.lines as line (line.id)}
							<li
								class="flex h-6 min-w-0 items-center gap-2 text-sm"
								data-slot="task-line"
								data-kind={line.kind}
								data-task-id={line.taskId ?? undefined}
							>
								<span class="size-1.5 shrink-0 rounded-full {KIND_DOT[line.kind]}" aria-hidden="true"></span>
								<span class="min-w-0 truncate" title={line.name}>{line.name}</span>
								{#if line.note}<span class="text-muted-foreground min-w-0 truncate text-xs" title={line.note}>{line.note}</span>{/if}
								<span class="text-muted-foreground ml-auto shrink-0 pl-2 text-xs whitespace-nowrap" title={kindMeaning(line.kind, entityType)}>
									{line.label}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	{/if}
</section>
