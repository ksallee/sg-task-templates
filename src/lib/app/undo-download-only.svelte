<!--
	When the undo store is memory only (`session.persistent` false): the warning and the download.
	`before`: shown before the run starts, when there is nothing of this run to download yet.
-->
<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { session } from '$lib/app/apply.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import Notice from './notice.svelte';

	let { before = false }: { before?: boolean } = $props();

	const hasRecords = $derived(!before && session.records().length > 0);
</script>

<Notice tone="warning" title="Undo is download-only in this browser. " data-slot="undo-download-only">
	Download the undo record as entities are applied, and before you close the tab.
	{#snippet action()}
		<Button size="sm" variant="outline" onclick={() => session.download()} disabled={!hasRecords}>
			<Download data-icon="inline-start" />
			{hasRecords ? 'Download undo record' : 'Nothing to download yet'}
		</Button>
	{/snippet}
</Notice>
