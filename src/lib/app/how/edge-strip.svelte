<!--
	/how's picture of a dependency the apply removes: before, after Flow PT's apply (gone, and not
	revivable), after this app with Keep (re-created: same ends, type and offset, a new id).
-->
<script lang="ts">
	const frames = [
		{ title: 'Before', line: 'Comp waits on Anim.', state: 'on' },
		{ title: 'Flow PT’s apply', line: 'Removed. Can’t be restored.', state: 'gone' },
		{ title: 'This app, Keep', line: 'Re-created right after, a new id.', state: 'back' }
	] as const;
</script>

<figure class="grid gap-2 sm:grid-cols-3" data-slot="edge-strip">
	{#each frames as f (f.title)}
		<div class="bg-card flex flex-col gap-2 rounded-lg border p-3">
			<span class="text-xs font-medium">{f.title}</span>
			<svg viewBox="0 0 150 36" class="h-9 w-full" aria-hidden="true" focusable="false">
				<rect x="1" y="8" width="48" height="20" rx="4" class="fill-muted stroke-border" />
				<text x="25" y="22" text-anchor="middle" class="fill-foreground text-[11px]">Anim</text>
				<rect x="101" y="8" width="48" height="20" rx="4" class="fill-muted stroke-border" />
				<text x="125" y="22" text-anchor="middle" class="fill-foreground text-[11px]">Comp</text>
				{#if f.state === 'on'}
					<path d="M52 18 H94" class="stroke-muted-foreground" stroke-width="1.5" />
					<path d="M92 14 L98 18 L92 22" class="stroke-muted-foreground" stroke-width="1.5" fill="none" />
				{:else if f.state === 'gone'}
					<path d="M52 18 H94" class="stroke-destructive" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.6" />
					<path d="M69 12 L81 24 M81 12 L69 24" class="stroke-destructive" stroke-width="1.75" />
				{:else}
					<path d="M52 18 H94" class="stroke-success" stroke-width="1.5" />
					<path d="M92 14 L98 18 L92 22" class="stroke-success" stroke-width="1.5" fill="none" />
				{/if}
			</svg>
			<span class="text-muted-foreground text-xs">{f.line}</span>
		</div>
	{/each}
</figure>
