<!--
	The confirmation before an undo: what it puts back, and what it cannot (undo's notes, read from
	the records before anything runs). One dialog for a whole run and for one entity.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { describeNote, undoPreviewNotes, type NameBook } from '$lib/pure/result-view';
	import type { UndoRecord } from '$lib/pure/types';

	let {
		open = $bindable(false),
		title,
		records,
		names,
		onconfirm
	}: { open?: boolean; title: string; records: UndoRecord[]; names: NameBook; onconfirm: () => void } = $props();

	const notes = $derived(undoPreviewNotes(records).map((n) => describeNote(n, names)));
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg" data-slot="undo-dialog">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				Puts back {records.length === 1 ? 'this entity' : `${records.length} entities`} as they were before the apply: the old template,
				the old links, the fields and statuses, the Tasks the apply deleted (revived), and deletes the Tasks it created.
			</Dialog.Description>
		</Dialog.Header>
		{#if notes.length}
			<div class="flex flex-col gap-1">
				<p class="text-sm font-medium">What undo cannot put back exactly</p>
				<ul class="text-muted-foreground list-disc space-y-1 pl-5 text-sm" data-slot="undo-notes">
					{#each notes as note, i (i)}<li>{note}</li>{/each}
				</ul>
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>Keep it</Button>
			<Button
				variant="destructive"
				onclick={() => {
					open = false;
					onconfirm();
				}}
			>
				Undo
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
