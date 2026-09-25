<!--
	One entity on the result screen (result-blocks.ts): its name and outcome, Retry on a failure,
	undo in its menu; the error or the differences inline; its Tasks by Pipeline Step, one line each
	with the outcome label (kinds.ts). Bordered card, no fill of its own.
-->
<script lang="ts" module>
	import type { LineKind } from '$lib/pure/result-blocks';

	const KIND_DOT: Record<LineKind, string> = {
		create: 'bg-success',
		claim: 'bg-info',
		keep: 'bg-muted-foreground',
		extra: 'bg-muted-foreground/50'
	};
</script>

<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import LineState from '$lib/app/line-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import { kindMeaning } from '$lib/pure/kinds';
	import type { ResultBlock } from '$lib/pure/result-blocks';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

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
		differences: 'Applied with differences',
		landed: 'Applied earlier'
	};
</script>

<section class="bg-card text-card-foreground flex min-w-0 flex-col gap-3 rounded-lg border p-4" data-slot="result-block" data-kind={block.kind}>
	<header class="flex min-h-7 flex-wrap items-center gap-2">
		<h2 class="min-w-0 truncate text-sm font-semibold" title={block.label}>{block.label}</h2>
		<LineState state={block.kind} label={STATE_WORD[block.kind]} />
		<div class="ml-auto flex items-center gap-1">
			{#if block.canRetry}
				<Button size="sm" variant="outline" onclick={onretry} disabled={busy}>Retry</Button>
			{/if}
			{#if block.canUndo}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} size="icon-sm" variant="ghost" aria-label={`Actions for ${block.label}`}><Ellipsis /></Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="min-w-44">
						<DropdownMenu.Item variant="destructive" disabled={busy} onSelect={onundo}>
							<RotateCcw /> Undo this {entityType ?? 'entity'}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</header>

	{#if block.error}
		<Notice tone="destructive" title="Error: " data-slot="block-error">{block.error}</Notice>
	{/if}
	{#if block.differences.length}
		<div class="border-warning/60 bg-warning/10 flex flex-col gap-1 rounded-lg border px-3 py-2 text-sm" data-slot="block-differences">
			<p class="font-medium">Differs from the plan:</p>
			<ul class="marker:text-muted-foreground flex list-disc flex-col gap-0.5 pl-5">
				{#each block.differences as text, i (i)}<li>{text}</li>{/each}
			</ul>
		</div>
	{/if}
	{#if block.tally}
		<p class="text-muted-foreground text-sm">{block.tally}. Applied in an earlier session.</p>
	{:else if block.kind === 'undone'}
		<p class="text-muted-foreground text-sm">Restored to its state before the apply.</p>
	{:else if block.kind === 'not_applied'}
		<p class="text-muted-foreground text-sm">The run stopped before this {entityType ?? 'entity'}.</p>
	{:else if block.kind === 'landing'}
		<p class="text-muted-foreground text-sm">Applying.</p>
	{/if}

	{#if block.steps.length}
		<div class="flex flex-col gap-3" data-slot="block-steps">
			{#each block.steps as group (group.step)}
				<div class="flex flex-col gap-1">
					<h3 class="text-muted-foreground text-xs font-medium">{group.step}</h3>
					<ul class="flex flex-col">
						{#each group.lines as line (line.id)}
							<li class="flex min-h-7 items-center gap-3 text-sm" data-slot="task-line" data-kind={line.kind} data-task-id={line.taskId ?? undefined}>
								<span class="min-w-0 flex-1 truncate" title={line.name}>{line.name}</span>
								{#if line.note}<span class="text-muted-foreground truncate text-xs">{line.note}</span>{/if}
								<span
									class="border-border inline-flex h-5 w-32 shrink-0 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap"
									title={kindMeaning(line.kind, entityType)}
								>
									<span class="size-2 shrink-0 rounded-full {KIND_DOT[line.kind]}" aria-hidden="true"></span>
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
