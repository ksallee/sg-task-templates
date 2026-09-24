<!--
	A titled block inside a page (docs/design.md): section title, a count or note beside it, actions
	on the right, then the content. `card` puts it on a bordered card surface.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		title,
		meta,
		actions,
		children,
		card = false,
		class: className,
		...rest
	}: {
		title?: string;
		/** Beside the title: a count, a short note. */
		meta?: string | Snippet;
		actions?: Snippet;
		children: Snippet;
		card?: boolean;
		class?: string;
		[key: `data-${string}`]: string | undefined;
		'aria-label'?: string;
	} = $props();
</script>

<section class={cn('flex min-w-0 flex-col gap-3', card && 'bg-card text-card-foreground rounded-lg border p-4', className)} {...rest}>
	{#if title || actions}
		<div class="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
			{#if title}<h2 class="text-sm font-semibold">{title}</h2>{/if}
			{#if typeof meta === 'string'}
				<span class="text-muted-foreground text-xs tabular-nums">{meta}</span>
			{:else if meta}
				{@render meta()}
			{/if}
			{#if actions}<div class="ml-auto flex items-center gap-2">{@render actions()}</div>{/if}
		</div>
	{/if}
	{@render children()}
</section>
