<!--
	Undo from a file, before anything runs: each run in the file with its entities and when it was
	applied. Entities the store marks undone are refused. The button undoes the rest.
-->
<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { FileRun } from '$lib/pure/result-view';
	import { localTime } from '$lib/pure/time';
	import type { UndoRecord } from '$lib/pure/types';

	let { open = $bindable(false), runs, onconfirm }: { open?: boolean; runs: FileRun[]; onconfirm: (records: UndoRecord[]) => void } = $props();

	const records = $derived(runs.flatMap((r) => r.records));
	const entities = (n: number) => `${n} ${n === 1 ? 'entity' : 'entities'}`;
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl" data-slot="undo-file-dialog">
		<Dialog.Header>
			<Dialog.Title>{runs.length === 1 ? 'Undo this run?' : `Undo these ${runs.length} runs?`}</Dialog.Title>
			<Dialog.Description>
				{records.length ? `Undoes ${entities(records.length)} from the file.` : 'Every entity in this file is undone already.'}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
			{#each runs as r (r.runId)}
				<div class="flex flex-col gap-1.5" data-slot="file-run">
					<p class="text-sm">
						<span class="font-medium">{r.title}</span>
						<span class="text-muted-foreground tabular-nums">, applied {localTime(r.appliedAt)}</span>
					</p>
					<ul class="flex flex-col gap-0.5 text-sm">
						{#each r.entities as e (e.key)}
							<li class="flex items-center gap-2" data-undone={e.undone}>
								<span class={e.undone ? 'text-muted-foreground line-through' : ''}>{e.label}</span>
								{#if e.undone}<span class="text-muted-foreground text-xs">undone already</span>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button
				variant="destructive"
				disabled={records.length === 0}
				onclick={() => {
					open = false;
					onconfirm(records);
				}}
			>
				Undo {entities(records.length)}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
