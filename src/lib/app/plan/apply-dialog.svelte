<!--
	Apply's confirm: one line of totals; when Tasks are deleted, a destructive notice on top with
	each Task (the second confirmation); then the risky items (apply-confirm.ts), the undo warning
	when the store is download-only, and Cancel / the confirm button. Confirm is the caller's.
-->
<script lang="ts">
	import type { ApplyConfirm } from '$lib/pure/apply-confirm';
	import Notice from '$lib/app/notice.svelte';
	import UndoDownloadOnly from '$lib/app/undo-download-only.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	let {
		open = $bindable(false),
		content,
		persistent,
		onConfirm
	}: { open?: boolean; content: ApplyConfirm; persistent: boolean; onConfirm: () => void } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-xl" data-slot="apply-dialog">
		<Dialog.Header>
			<Dialog.Title>{content.headline}</Dialog.Title>
			<Dialog.Description class="sr-only">Confirm the write to Flow PT.</Dialog.Description>
		</Dialog.Header>
		{#if content.deletes || content.sections.length || !persistent}
			<div class="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
				{#if content.deletes}
					<section class="flex flex-col gap-2" data-slot="apply-deletes">
						<Notice tone="destructive" title={content.deletes.title} />
						<ul class="flex flex-col gap-1 text-sm">
							{#each content.deletes.lines as line, i (i)}
								<li class={line.loud ? 'text-destructive font-medium' : ''}>{line.text}</li>
							{/each}
						</ul>
					</section>
				{/if}
				{#each content.sections as section (section.title)}
					<section class="flex flex-col gap-1.5" data-slot="apply-risk">
						<h3 class="text-muted-foreground text-xs font-medium">{section.title}</h3>
						<ul class="flex flex-col gap-1 text-sm">
							{#each section.lines as line, i (i)}
								<li class={line.loud ? 'text-destructive font-medium' : ''}>{line.text}</li>
							{/each}
						</ul>
					</section>
				{/each}
				{#if !persistent}<UndoDownloadOnly before />{/if}
			</div>
		{/if}
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button variant={content.action.destructive ? 'destructive' : 'default'} onclick={onConfirm} data-slot="apply-confirm"
				>{content.action.label}</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
