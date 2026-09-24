<!--
	Result: per entity, landed (clean, or with the differences the read-back found), failed with a
	retry, undone, or never applied, grouped by outcome in the left rail; the picked entity's
	details on the right. Undo per run and per entity after a confirmation that lists what undo
	cannot put back; the undo record as JSON, down and up. `?run=<id>` shows a stored run (the
	resume banner's "Review and undo"). Logic in `$lib/pure/result-view.ts`.
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
	import { UNDO_STAGE_LABEL, describeNote, groupRows, mergeNotes, nameBook, resultRows, type ResultKind } from '$lib/pure/result-view';
	import type { UndoRecord } from '$lib/pure/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	const runId = page.url.searchParams.get('run');
	let missing = $state(false);
	const ready = (async () => {
		await run.start();
		if (runId) missing = !(await session.show(runId));
	})();

	const names = $derived(nameBook(session.plans));
	const rows = $derived(session.current ? resultRows(session.current, session.outcomes, names, session.retryable) : []);
	const groups = $derived(groupRows(rows));
	const undoable = $derived(rows.filter((r) => r.canUndo));
	const failedRetry = $derived(rows.filter((r) => r.kind === 'failed' && r.canRetry).map((r) => r.key));
	const tally = $derived(Object.fromEntries(groups.map((g) => [g.kind, g.rows.length])) as Partial<Record<ResultKind, number>>);
	const undoneOk = $derived(session.undone.filter((o) => o.kind === 'ok'));
	const undoneFailed = $derived(session.undone.filter((o) => o.kind === 'failed'));
	const undoneNotes = $derived(mergeNotes(undoneOk.map((o) => (o.kind === 'ok' ? o.notes : []))).map((n) => describeNote(n, names)));
	const leftEdges = $derived(undoneOk.reduce((n, o) => n + (o.kind === 'ok' ? o.left.length : 0), 0));

	let picked = $state<string | null>(null);
	const selected = $derived(rows.find((r) => r.key === picked) ?? groups[0]?.rows[0] ?? null);

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
	<Button {variant} onclick={() => fileInput?.click()} disabled={session.undoing}><Upload data-icon="inline-start" /> Undo from a file…</Button>
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
					<Download data-icon="inline-start" /> Download undo record
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
				{#if failedRetry.length}
					<Button onclick={() => void session.retry(failedRetry)} disabled={session.phase === 'running'}>
						Retry {failedRetry.length === 1 ? 'the failed entity' : `the ${failedRetry.length} failed`}
					</Button>
				{/if}
			{/if}
		{/snippet}
		{#if current}
			<div class="flex flex-wrap items-center gap-2" data-slot="result-summary">
				<LineState state="clean" count={tally.clean ?? 0} />
				<LineState state="differences" count={tally.differences ?? 0} />
				<LineState state="failed" count={tally.failed ?? 0} />
				{#if tally.landed}<LineState state="landed" label="Applied earlier" count={tally.landed} />{/if}
				{#if tally.landing}<LineState state="landing" count={tally.landing} />{/if}
				{#if tally.undone}<LineState state="undone" count={tally.undone} />{/if}
				{#if tally.not_applied}<LineState state="not_applied" count={tally.not_applied} />{/if}
			</div>
		{/if}
		{#if missing}<Notice tone="destructive">No stored run {runId} in this browser.</Notice>{/if}
		{#if fileError}<Notice tone="destructive" data-slot="upload-error">{fileError}</Notice>{/if}
		{#if session.error}<Notice tone="destructive">{session.error}</Notice>{/if}
		{#if !session.persistent && current}
			<Notice tone="warning" title="Undo is download-only in this browser. ">
				Download the undo record before you close the tab.
				{#snippet action()}
					<Button size="sm" variant="outline" onclick={() => session.download()} disabled={undoable.length === 0}>
						<Download data-icon="inline-start" /> Download
					</Button>
				{/snippet}
			</Notice>
		{/if}
	</PageHeader>

	{#if !current}
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{#if session.undone.length}
				<div class="flex w-full max-w-3xl flex-col gap-6 px-6 pt-6">{@render undoOutcome()}</div>
			{/if}
			<PageState state="empty" icon={History} title="No run in this tab" line="Apply a plan, or undo a run from its downloaded file.">
				{#snippet action()}
					{@render fromFile('outline')}
					<Button href="/plan">Go to the plan</Button>
				{/snippet}
			</PageState>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1" data-slot="result">
			<nav class="border-border flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r px-4 py-4" aria-label="Entities by outcome" data-slot="result-rows">
				{#each groups as group (group.kind)}
					<div class="flex flex-col gap-1">
						<h2 class="text-muted-foreground flex items-center gap-2 px-2 text-xs font-medium">
							{group.title}<span class="tabular-nums">{group.rows.length}</span>
						</h2>
						<ul class="flex flex-col">
							{#each group.rows as row (row.key)}
								<li>
									<button
										type="button"
										class={cn(
											'hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
											selected?.key === row.key && 'bg-accent font-medium'
										)}
										aria-current={selected?.key === row.key ? 'true' : undefined}
										onclick={() => (picked = row.key)}
										data-kind={row.kind}
									>
										<span class="min-w-0 flex-1 truncate" title={row.label}>{row.label}</span>
										{#if row.differences.length}<span class="text-muted-foreground text-xs tabular-nums">{row.differences.length}</span>{/if}
									</button>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</nav>
			<div class="flex min-w-0 flex-1 flex-col overflow-y-auto">
				<div class="flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
					{#if session.undone.length}{@render undoOutcome()}{/if}
					{#if selected}
						{@const row = selected}
						<Section title={row.label} data-slot="result-detail">
							{#snippet meta()}<LineState state={row.kind} label={row.kind === 'landed' ? 'Applied earlier' : undefined} />{/snippet}
							{#snippet actions()}
								{#if row.canRetry}
									<Button size="sm" variant="outline" onclick={() => void session.retry([row.key])} disabled={session.phase === 'running'}>Retry</Button>
								{/if}
								{#if row.canUndo && row.record}
									{@const record = row.record}
									<Button
										size="sm"
										variant="outline"
										class={undoTone}
										disabled={session.undoing}
										onclick={() => confirmUndo(`Undo ${row.label}?`, [record], [row.key])}
									>
										<RotateCcw data-icon="inline-start" /> Undo this entity
									</Button>
								{/if}
							{/snippet}
							{#if row.error}
								<Notice tone="destructive" title="Error: ">{row.error}</Notice>
							{/if}
							{#if row.differences.length}
								<div class="bg-card text-card-foreground flex flex-col gap-2 rounded-lg border p-4">
									<p class="text-sm">
										Applied. The read-back differs from the plan in {row.differences.length}
										{row.differences.length === 1 ? 'place' : 'places'}:
									</p>
									<ul class="marker:text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
										{#each row.differences as text, i (i)}<li>{text}</li>{/each}
									</ul>
								</div>
							{:else if row.kind === 'clean'}
								<p class="text-muted-foreground text-sm">Matches the plan.</p>
							{:else if row.kind === 'landed'}
								<p class="text-muted-foreground text-sm">Applied in an earlier session. No read-back to compare.</p>
							{:else if row.kind === 'undone'}
								<p class="text-muted-foreground text-sm">Restored to its state before the apply.</p>
							{:else if row.kind === 'not_applied'}
								<p class="text-muted-foreground text-sm">The run stopped before this entity.</p>
							{:else if row.kind === 'landing'}
								<p class="text-muted-foreground text-sm">Still applying.</p>
							{/if}
						</Section>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	{#if dialog}
		{@const d = dialog}
		<UndoDialog bind:open={dialogOpen} title={d.title} records={d.records} {names} onconfirm={() => void session.undo(d.keys)} />
	{/if}
{/await}
