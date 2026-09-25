<!--
	Home's one picture: a Shot's Tasks after two applies of the same template. Left, Flow PT's own
	apply (forum topic 20654): the old Tasks are flagged; kept, they are duplicated; deleted, their
	Versions are orphaned. Right, this app: matched by name and step,
	linked, only the missing Task created. Static, drawn with theme tokens only; the words match the
	plan's outcome labels (linked, created).
-->
<script lang="ts">
	import Video from '@lucide/svelte/icons/video';
	import { cn } from '$lib/utils.js';

	type Row = { name: string; tag: string; tone: 'dup' | 'gone' | 'new' | 'linked' | 'created'; versions?: string };

	/**
	 * One line per template task, both sides: Flow PT's Tasks for it (an old one kept beside the new
	 * one, or deleted with its Versions orphaned), and this app's single Task.
	 */
	const lines: Array<{ theirs: Row[]; ours: Row }> = [
		{
			theirs: [
				{ name: 'Layout', tag: 'old', tone: 'dup' },
				{ name: 'Layout', tag: 'new', tone: 'dup' }
			],
			ours: { name: 'Layout', tag: 'linked', tone: 'linked' }
		},
		{
			theirs: [
				{ name: 'Anim', tag: 'old', tone: 'dup' },
				{ name: 'Anim', tag: 'new', tone: 'dup' }
			],
			ours: { name: 'Anim', tag: 'linked', tone: 'linked' }
		},
		{
			theirs: [
				{ name: 'Comp', tag: 'deleted', tone: 'gone', versions: '3 Versions, orphaned' },
				{ name: 'Comp', tag: 'new', tone: 'new' }
			],
			ours: { name: 'Comp', tag: 'linked', tone: 'linked', versions: '3 Versions' }
		},
		{ theirs: [{ name: 'Light', tag: 'new', tone: 'new' }], ours: { name: 'Light', tag: 'created', tone: 'created' } }
	];

	const DOT: Record<Row['tone'], string> = {
		dup: 'bg-warning',
		gone: 'bg-destructive',
		new: 'bg-muted-foreground/50',
		linked: 'bg-info',
		created: 'bg-success'
	};
</script>

{#snippet row(r: Row)}
	<div class="flex min-h-8 items-center gap-2.5 px-3 py-1.5 text-sm">
		<span class={cn('size-2 shrink-0 rounded-full', DOT[r.tone])} aria-hidden="true"></span>
		<span class={cn('font-medium', r.tone === 'gone' && 'text-muted-foreground line-through decoration-destructive/70')}>{r.name}</span>
		{#if r.versions}
			<span
				class={cn('flex items-center gap-1 text-xs', r.tone === 'gone' ? 'text-destructive' : 'text-muted-foreground')}
				><Video class="size-3.5" aria-hidden="true" />{r.versions}</span
			>
		{/if}
		<span
			class={cn(
				'ml-auto text-xs',
				r.tone === 'gone' ? 'text-destructive' : r.tone === 'linked' || r.tone === 'created' ? 'text-foreground' : 'text-muted-foreground'
			)}>{r.tag}</span
		>
	</div>
{/snippet}

<figure class="flex w-full flex-col gap-4" data-slot="merge-picture">
	<figcaption class="text-muted-foreground text-center text-sm text-balance">
		Shot <span class="text-foreground font-medium">sh010</span> has Layout, Anim and Comp. Comp has 3 Versions. The
		Task Template adds Light.
	</figcaption>

	<!-- One subgrid row per template task: each Task is level with its counterpart. -->
	<div class="grid gap-x-4 md:grid-cols-2">
		<div class="bg-card row-span-6 grid grid-rows-subgrid rounded-lg border" data-side="flow-pt">
			<div class="flex items-baseline justify-between gap-3 border-b px-3 py-2.5">
				<h3 class="text-sm font-semibold">Flow PT’s apply</h3>
				<span class="text-muted-foreground text-xs tabular-nums">6 Tasks, 1 deleted</span>
			</div>
			{#each lines as line, i (i)}
				<div class={cn('px-2', i === 0 && 'pt-2', i === lines.length - 1 && 'pb-2', i > 0 && 'pt-1.5')}>
					{#if line.theirs.length > 1}
						<div
							class={cn(
								'flex flex-col rounded-md border',
								line.theirs[0].tone === 'gone' ? 'border-destructive/40 border-dashed' : 'border-warning/50 bg-warning/10 divide-warning/30 divide-y'
							)}
						>
							{#each line.theirs as r, j (j)}
								<div class={cn(r.tone === 'gone' && 'bg-destructive/5 rounded-t-md')}>{@render row(r)}</div>
							{/each}
						</div>
					{:else}
						{@render row(line.theirs[0])}
					{/if}
				</div>
			{/each}
			<p class="text-muted-foreground border-t px-3 py-2.5 text-xs leading-relaxed">
				Flow PT flags the old Tasks. You keep them or delete them.
			</p>
		</div>

		<div class="bg-card row-span-6 grid grid-rows-subgrid rounded-lg border max-md:mt-4" data-side="this-app">
			<div class="flex items-baseline justify-between gap-3 border-b px-3 py-2.5">
				<h3 class="text-sm font-semibold">This app</h3>
				<span class="text-muted-foreground text-xs tabular-nums">4 Tasks</span>
			</div>
			{#each lines as line, i (i)}
				<div class={cn('flex flex-col justify-center px-2', i === 0 && 'pt-2', i === lines.length - 1 && 'pb-2', i > 0 && 'pt-1.5')}>
					<div class="rounded-md border border-transparent">{@render row(line.ours)}</div>
				</div>
			{/each}
			<p class="text-muted-foreground border-t px-3 py-2.5 text-xs leading-relaxed">
				Status and assignees are unchanged.
			</p>
		</div>
	</div>
</figure>
