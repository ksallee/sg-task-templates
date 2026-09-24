<!--
	Result: per entity, landed (clean, or with the differences the read-back found), failed with a
	retry, undone, or never applied. Undo per run and per entity after a confirmation that lists
	what undo cannot put back; the undo record as JSON, down and up. `?run=<id>` shows a stored run
	(the resume banner's "Review and undo"). Logic in `$lib/pure/result-view.ts`.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { run } from '$lib/app/run.svelte';
	import { session } from '$lib/app/apply.svelte';
	import LineState from '$lib/app/line-state.svelte';
	import UndoDialog from '$lib/app/undo-dialog.svelte';
	import { entityLabel } from '$lib/pure/apply-view';
	import { describeNote, mergeNotes, nameBook, resultRows } from '$lib/pure/result-view';
	import type { UndoRecord } from '$lib/pure/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Table from '$lib/components/ui/table/index.js';

	const runId = page.url.searchParams.get('run');
	let missing = $state(false);
	const ready = (async () => {
		await run.start();
		if (runId) missing = !(await session.show(runId));
	})();

	const names = $derived(nameBook(session.plans));
	const rows = $derived(session.current ? resultRows(session.current, session.outcomes, names, session.retryable) : []);
	const undoable = $derived(rows.filter((r) => r.canUndo));
	const failedRetry = $derived(rows.filter((r) => r.kind === 'failed' && r.canRetry).map((r) => r.key));
	const undoneOk = $derived(session.undone.filter((o) => o.kind === 'ok'));
	const undoneFailed = $derived(session.undone.filter((o) => o.kind === 'failed'));
	const undoneNotes = $derived(mergeNotes(undoneOk.map((o) => (o.kind === 'ok' ? o.notes : []))).map((n) => describeNote(n, names)));
	const leftEdges = $derived(undoneOk.reduce((n, o) => n + (o.kind === 'ok' ? o.left.length : 0), 0));

	let dialog = $state<{ title: string; records: UndoRecord[]; keys?: string[] } | null>(null);
	let dialogOpen = $state(false);
	let fileError = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	function confirmUndo(title: string, records: UndoRecord[], keys?: string[]): void {
		dialog = { title, records, keys };
		dialogOpen = true;
	}

	async function upload(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		fileError = null;
		try {
			await session.undoFile(file);
		} catch (error) {
			fileError = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<svelte:head><title>Result · SG Task Templates</title></svelte:head>

{#await ready}
	<p class="text-muted-foreground p-6 text-sm">Reading the run…</p>
{:then}
	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6" data-slot="result">
		<div class="flex flex-wrap items-center gap-2">
			<h1 class="mr-auto text-base font-semibold">
				{#if session.current}
					{session.current.template.code} · {session.current.startedAt.slice(0, 16).replace('T', ' ')}
				{:else}
					Result
				{/if}
			</h1>
			<input bind:this={fileInput} type="file" accept="application/json,.json" class="hidden" onchange={upload} data-slot="undo-upload" />
			<Button size="sm" variant="ghost" onclick={() => fileInput?.click()} disabled={session.undoing}>Undo from a file…</Button>
			{#if session.current}
				<Button size="sm" variant="outline" onclick={() => session.download()} disabled={undoable.length === 0}>Download undo record</Button>
				<Button
					size="sm"
					variant="destructive"
					disabled={undoable.length === 0 || session.undoing || session.phase === 'running'}
					onclick={() => confirmUndo(`Undo the run on ${undoable.length} ${undoable.length === 1 ? 'entity' : 'entities'}?`, session.records())}
				>
					{session.undoing ? 'Undoing…' : 'Undo run'}
				</Button>
			{/if}
		</div>

		{#if missing}<p class="text-destructive text-sm">No stored run {runId} in this browser.</p>{/if}
		{#if fileError}<p class="text-destructive text-sm" data-slot="upload-error">{fileError}</p>{/if}
		{#if session.error}<p class="text-destructive text-sm">{session.error}</p>{/if}
		{#if !session.persistent && session.current}
			<p class="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="alert">
				Undo is download-only in this browser: the record lives in this tab. Download it before you close the tab.
			</p>
		{/if}

		{#if session.undone.length}
			<section class="flex flex-col gap-1 rounded-md border p-3 text-sm" data-slot="undo-outcome">
				<p class="font-medium">Undo: {undoneOk.length} put back{undoneFailed.length ? `, ${undoneFailed.length} failed` : ''}.</p>
				{#each undoneFailed as o (o.entity.id)}
					{#if o.kind === 'failed'}<p class="text-destructive">{entityLabel(o.entity)}: {o.error.message} (at {o.stage})</p>{/if}
				{/each}
				{#if undoneNotes.length}
					<ul class="text-muted-foreground list-disc space-y-0.5 pl-5">
						{#each undoneNotes as text, i (i)}<li>{text}</li>{/each}
					</ul>
				{/if}
				{#if leftEdges}<p class="text-muted-foreground">{leftEdges} live {leftEdges === 1 ? 'dependency' : 'dependencies'} the record does not know were left in place.</p>{/if}
			</section>
		{/if}

		{#if !session.current}
			<p class="text-muted-foreground text-sm">No run in this tab. Apply a plan, or undo a run from its downloaded file.</p>
		{:else}
			{#if failedRetry.length > 1}
				<Button size="sm" variant="outline" class="self-start" onclick={() => void session.retry(failedRetry)} disabled={session.phase === 'running'}>
					Retry the {failedRetry.length} failed
				</Button>
			{/if}
			<Table.Root data-slot="result-rows">
				<Table.Header>
					<Table.Row>
						<Table.Head>Entity</Table.Head>
						<Table.Head>Result</Table.Head>
						<Table.Head>Details</Table.Head>
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each rows as row (row.key)}
						<Table.Row data-kind={row.kind}>
							<Table.Cell class="align-top font-medium">{row.label}</Table.Cell>
							<Table.Cell class="align-top"><LineState state={row.kind} /></Table.Cell>
							<Table.Cell class="align-top whitespace-normal">
								{#if row.error}<p class="text-destructive">{row.error}</p>{/if}
								{#if row.differences.length}
									<ul class="list-disc space-y-0.5 pl-5">
										{#each row.differences as text, i (i)}<li>{text}</li>{/each}
									</ul>
								{:else if row.kind === 'clean'}
									<span class="text-muted-foreground">Read back as planned.</span>
								{:else if row.kind === 'landed'}
									<span class="text-muted-foreground">Landed in an earlier session: no read-back to compare here.</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="space-x-1 text-right align-top">
								{#if row.canRetry}
									<Button size="sm" variant="outline" onclick={() => void session.retry([row.key])} disabled={session.phase === 'running'}>Retry</Button>
								{/if}
								{#if row.canUndo && row.record}
									{@const record = row.record}
									<Button size="sm" variant="ghost" disabled={session.undoing} onclick={() => confirmUndo(`Undo ${row.label}?`, [record], [row.key])}>Undo</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</div>

	{#if dialog}
		{@const d = dialog}
		<UndoDialog bind:open={dialogOpen} title={d.title} records={d.records} {names} onconfirm={() => void session.undo(d.keys)} />
	{/if}
{/await}
