<!--
	The confirmation before an undo: what it puts back, and what it cannot (undo's notes, read from
	the records before anything runs). One dialog for a whole run and for one entity.
-->
<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
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

	/** What undo writes back (undo.ts, revert.ts). */
	const PUTS_BACK = [
		'The old template on the entity, and the old links of its Tasks.',
		'The fields and statuses the apply changed, and the names.',
		'Assignees the apply filled, cleared again; dates it filled on a Task with nothing upstream, cleared again.',
		'Tasks the apply deleted, revived; Tasks it created, deleted.',
		'Dependencies the apply removed, revived or re-created; the ones it added, removed.'
	];
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl" data-slot="undo-dialog">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				Puts {records.length === 1 ? 'this entity' : `${records.length} entities`} back as {records.length === 1 ? 'it was' : 'they were'} before the apply. Each entity is its own undo: one can fail while the others land.
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
			<div class="flex flex-col gap-1.5">
				<p class="flex items-center gap-2 text-sm font-medium"><CircleCheck class="text-success size-4" aria-hidden="true" /> What it puts back</p>
				<ul class="marker:text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
					{#each PUTS_BACK as text, i (i)}<li>{text}</li>{/each}
				</ul>
			</div>
			{#if notes.length}
				<div class="flex flex-col gap-1.5">
					<p class="flex items-center gap-2 text-sm font-medium">
						<TriangleAlert class="text-warning size-4" aria-hidden="true" /> What it cannot put back exactly
					</p>
					<ul class="text-muted-foreground marker:text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm" data-slot="undo-notes">
						{#each notes as note, i (i)}<li>{note}</li>{/each}
					</ul>
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>Keep it</Button>
			<Button
				variant="destructive"
				onclick={() => {
					open = false;
					onconfirm();
				}}
			>
				{records.length === 1 ? 'Undo this entity' : `Undo ${records.length} entities`}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
