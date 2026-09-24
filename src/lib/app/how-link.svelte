<!--
	A small "?" beside a concept on a screen, linking to the /how section that explains it. The
	anchor comes from `$lib/pure/how.ts`, so a renamed section breaks a test, not a link. Opens in a
	new tab: the plan in progress stays where it is.

	<HowLink concept="claim" />
-->
<script lang="ts">
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import { howHref, type HowConcept } from '$lib/pure/how';
	import { cn } from '$lib/utils.js';

	let { concept, label, class: className }: { concept: HowConcept; label?: string; class?: string } = $props();
	const text = $derived(label ?? 'How this works');
</script>

<a
	href={howHref(concept)}
	target="_blank"
	rel="noopener"
	class={cn(
		'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-4 shrink-0 items-center justify-center rounded-full align-middle outline-none focus-visible:ring-2',
		className
	)}
	title={text}
	aria-label={text}
	data-slot="how-link"
>
	<CircleHelp class="size-3.5" aria-hidden="true" />
</a>
