<!--
	Result: the run's summary, then one block per entity with its Tasks by Pipeline Step, failures
	and differences inline; entities with nothing to write in one line. Undo per run (top right) and
	per entity (its block's menu) after a confirmation that lists what undo cannot put back; the
	undo file down and up. `?run=<id>` shows a stored run (the resume banner's "Review and undo").
	Logic in `$lib/pure/result-view.ts` and `$lib/pure/result-blocks.ts`.
-->
<script lang="ts">
	import { page } from '$app/state';
	import Download from '@lucide/svelte/icons/download';
	import History from '@lucide/svelte/icons/history';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Upload from '@lucide/svelte/icons/upload';
	import { run } from '$lib/app/run.svelte';
	import { session } from '$lib/app/apply.svelte';
	import LineState from '$lib/app/line-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import UndoDialog from '$lib/app/undo-dialog.svelte';
	import { entityLabel } from '$lib/pure/apply-view';
	import EntityBlock from '$lib/app/result/entity-block.svelte';
	import { resultBlocks, runTotals, unchangedLine } from '$lib/pure/result-blocks';
	import { UNDO_STAGE_LABEL, describeNote, mergeNotes, nameBook, resultRows, type ResultKind } from '$lib/pure/result-view';
	import type { UndoRecord } from '$lib/pure/types';
	import { Button } from '$lib/components/ui/button/index.js';

	const runId = page.url.searchParams.get('run');
	let missing = $state(false);
	const ready = (async () => {
		await run.start();
		if (runId) missing = !(await session.show(runId));
	})();

	const names = $derived(nameBook(session.plans, run.fieldLabels));
	const rows = $derived(session.current ? resultRows(session.current, session.outcomes, names, session.retryable) : []);
	const blocks = $derived(resultBlocks(rows, session.plans, session.outcomes, session.current?.options.omitStatus ?? ''));
	const totals = $derived(runTotals(blocks));
	const unchanged = $derived(session.source ? unchangedLine(session.source, run.entityType) : null);
	const undoable = $derived(rows.filter((r) => r.canUndo));
	const failedRetry = $derived(rows.filter((r) => r.kind === 'failed' && r.canRetry).map((r) => r.key));
	const tally = $derived(
		rows.reduce<Partial<Record<ResultKind, number>>>((t, r) => ({ ...t, [r.kind]: (t[r.kind] ?? 0) + 1 }), {})
	);
	const undoneOk = $derived(session.undone.filter((o) => o.kind === 'ok'));
	const undoneFailed = $derived(session.undone.filter((o) => o.kind === 'failed'));
	const undoneNotes = $derived(mergeNotes(undoneOk.map((o) => (o.kind === 'ok' ? o.notes : []))).map((n) => describeNote(n, names)));
	const leftEdges = $derived(undoneOk.reduce((n, o) => n + (o.kind === 'ok' ? o.left.length : 0), 0));

	let dialog = $state<{ title: string; records: UndoRecord[]; keys?: string[] } | null>(null);
	let dialogOpen = $state(false);
	let fileError = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	const entities = (n: number) => `${n} ${n === 1 ? 'entity' : 'entities'}`;
	const time = (iso: string) => iso.slice(0, 16).replace('T', ' ');
	/** Undo is the one destructive action here, drawn as a secondary in the destructive tone. */
	const undoTone = 'text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10';

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

<input bind:this={fileInput} type="file" accept="application/json,.json" class="hidden" onchange={upload} data-slot="undo-upload" />

{#snippet fromFile(variant: 'ghost' | 'outline')}
	<Button {variant} onclick={() => fileInput?.click()} disabled={session.undoing}><Upload data-icon="inline-start" /> Undo from file…</Button>
{/snippet}

{#snippet undoOutcome()}
	<Section title="Last undo" meta={`${undoneOk.length} undone${undoneFailed.length ? ` · ${undoneFailed.length} failed` : ''}`} card data-slot="undo-outcome">
		<div class="flex flex-col gap-2 text-sm">
			{#each undoneFailed as o (o.entity.id)}
				{#if o.kind === 'failed'}
					<p class="text-destructive"><span class="font-medium">{entityLabel(o.entity)}</span>: {o.error.message} (while {UNDO_STAGE_LABEL[o.stage]})</p>
				{/if}
			{/each}
			{#if undoneNotes.length}
				<ul class="text-muted-foreground marker:text-muted-foreground flex list-disc flex-col gap-1 pl-5">
					{#each undoneNotes as text, i (i)}<li>{text}</li>{/each}
				</ul>
			{/if}
			{#if leftEdges}
				<p class="text-muted-foreground">
					{leftEdges} {leftEdges === 1 ? 'dependency' : 'dependencies'} not in the undo record: not changed.
				</p>
			{/if}
		</div>
	</Section>
{/snippet}

{#await ready}
	<PageState state="loading" title="Reading the run…" />
{:then}
	{@const current = session.current}
	<PageHeader title="Result">
		{#snippet context()}
			{#if current}
				<span>{current.project.name ?? `Project ${current.project.id}`}</span>
				<span aria-hidden="true">·</span>
				<span class="text-foreground font-medium">{current.template.code}</span>
				<span aria-hidden="true">·</span>
				<span class="tabular-nums">started {time(current.startedAt)}</span>
				{#if current.user.name}<span aria-hidden="true">·</span><span>by {current.user.name}</span>{/if}
			{:else}
				<span>What an apply wrote, and its undo.</span>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if current}
				{@render fromFile('ghost')}
				<Button variant="outline" onclick={() => session.download()} disabled={undoable.length === 0}>
					<Download data-icon="inline-start" /> Download undo file
				</Button>
				<Button
					variant="outline"
					class={undoTone}
					disabled={undoable.length === 0 || session.undoing || session.phase === 'running'}
					onclick={() => confirmUndo(`Undo the run on ${entities(undoable.length)}?`, session.records())}
				>
					<RotateCcw data-icon="inline-start" />
					{session.undoing ? 'Undoing…' : 'Undo run'}
				</Button>
			{/if}
		{/snippet}
		{#if current}
			<div class="flex flex-col gap-2" data-slot="result-summary">
				<div class="flex flex-wrap items-center gap-2">
					<LineState state="clean" count={tally.clean ?? 0} />
					<LineState state="differences" label="Applied with differences" count={tally.differences ?? 0} />
					<LineState state="failed" count={tally.failed ?? 0} />
					{#if tally.landed}<LineState state="landed" label="Applied earlier" count={tally.landed} />{/if}
					{#if tally.landing}<LineState state="landing" count={tally.landing} />{/if}
					{#if tally.undone}<LineState state="undone" count={tally.undone} />{/if}
					{#if tally.not_applied}<LineState state="not_applied" count={tally.not_applied} />{/if}
					{#if failedRetry.length}
						<Button size="sm" variant="outline" onclick={() => void session.retry(failedRetry)} disabled={session.phase === 'running'}>
							Retry {failedRetry.length === 1 ? 'the failed one' : `the ${failedRetry.length} failed`}
						</Button>
					{/if}
				</div>
				{#if totals.length}
					<p class="text-muted-foreground text-sm" data-slot="result-totals">
						Tasks: {totals.map((t) => t.text).join(', ')}.
					</p>
				{/if}
			</div>
		{/if}
		{#if missing}<Notice tone="destructive">No stored run {runId} in this browser.</Notice>{/if}
		{#if fileError}<Notice tone="destructive" data-slot="upload-error">{fileError}</Notice>{/if}
		{#if session.error}<Notice tone="destructive">{session.error}</Notice>{/if}
		{#if !session.persistent && current}
			<Notice tone="warning" title="Undo is download-only in this browser. ">
				Download the undo file before you close the tab.
				{#snippet action()}
					<Button size="sm" variant="outline" onclick={() => session.download()} disabled={undoable.length === 0}>
						<Download data-icon="inline-start" /> Download
					</Button>
				{/snippet}
			</Notice>
		{/if}
	</PageHeader>

	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
		{#if !current}
			{#if session.undone.length}
				<div class="flex w-full max-w-3xl flex-col gap-6 px-6 pt-6">{@render undoOutcome()}</div>
			{/if}
			<PageState state="empty" icon={History} title="No run in this tab" line="Apply a plan, or undo a run from its undo file.">
				{#snippet action()}
					{@render fromFile('outline')}
					<Button href="/plan">Go to the plan</Button>
				{/snippet}
			</PageState>
		{:else}
			<div class="flex w-full max-w-4xl flex-col gap-4 px-6 py-6" data-slot="result">
				{#if session.undone.length}{@render undoOutcome()}{/if}
				{#each blocks as block (block.key)}
					<EntityBlock
						{block}
						entityType={run.entityType}
						busy={session.undoing || session.phase === 'running'}
						onretry={() => void session.retry([block.key])}
						onundo={() => block.record && confirmUndo(`Undo ${block.label}?`, [block.record], [block.key])}
					/>
				{/each}
				{#if unchanged}
					<p class="text-muted-foreground rounded-lg border border-dashed px-4 py-3 text-sm" data-slot="result-unchanged">{unchanged}.</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if dialog}
		{@const d = dialog}
		<UndoDialog bind:open={dialogOpen} title={d.title} records={d.records} {names} onconfirm={() => void session.undo(d.keys)} />
	{/if}
{/await}
