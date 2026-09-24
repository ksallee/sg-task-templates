<!--
	Apply: the last summary (the five totals, what will be written, where undo lives), a final
	confirm, then the run: one atomic batch per entity, about four in flight, a live line each.
	Cancel stops after the entities in flight. Logic in `$lib/pure/apply-view.ts`, state in
	`$lib/app/apply.svelte.ts`.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { run } from '$lib/app/run.svelte';
	import { session } from '$lib/app/apply.svelte';
	import LineState from '$lib/app/line-state.svelte';
	import { lineCounts, startBlockers, summaryLines, undoNote, writeSummary } from '$lib/pure/apply-view';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Table from '$lib/components/ui/table/index.js';

	const KINDS = ['keep', 'claim', 'create', 'extra', 'conflict'] as const;

	const started = run.start();
	onMount(() => void session.open());

	let confirmed = $state(false);
	const summary = $derived(run.options ? writeSummary(run.plans, run.options) : null);
	const blockers = $derived(run.options ? startBlockers(run.plans, run.options) : []);
	const note = $derived(undoNote(session.persistent));
	const counts = $derived(lineCounts(session.lines));
	const total = $derived(session.lines.length);
	const hasRecords = $derived(session.records().length > 0);
	const showRun = $derived(session.phase === 'running' || (session.phase === 'done' && session.source === run.plans && session.current !== null));
</script>

<svelte:head><title>Apply · SG Task Templates</title></svelte:head>

{#snippet downloadOnly()}
	<div class="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm" role="alert" data-slot="undo-download-only">
		<p class="min-w-0 flex-1">
			<span class="font-medium">Undo is download-only in this browser.</span>
			It cannot store the undo record: it lives in this tab only. Download it as entities land, and before you close the tab.
		</p>
		<Button size="sm" variant="outline" onclick={() => session.download()} disabled={!hasRecords}>
			{hasRecords ? 'Download undo record' : 'Download (once an entity lands)'}
		</Button>
	</div>
{/snippet}

{#await started}
	<p class="text-muted-foreground p-6 text-sm">Reaching the site…</p>
{:then}
	{#if run.problem}
		<div class="flex flex-col items-start gap-2 p-6">
			<p class="text-sm">{run.problem}</p>
			<Button size="sm" href="/connect">Connect</Button>
		</div>
	{:else if showRun && session.current}
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6" data-slot="apply-run">
			<div class="flex flex-wrap items-center gap-3">
				<h1 class="text-base font-semibold">{session.current.template.code}</h1>
				<span class="text-muted-foreground text-sm tabular-nums" data-slot="apply-progress">
					{counts.landed + counts.failed} of {total} done · {counts.landed} landed · {counts.failed} failed{counts.cancelled ? ` · ${counts.cancelled} cancelled` : ''}
				</span>
				<span class="mr-auto"></span>
				{#if session.phase === 'running'}
					<Button size="sm" variant="outline" onclick={() => session.cancel()} disabled={session.stopping}>
						{session.stopping ? 'Stopping after current…' : 'Cancel after current'}
					</Button>
				{:else}
					<Button size="sm" onclick={() => goto('/result')}>See the result</Button>
				{/if}
			</div>
			<div class="bg-muted h-1.5 w-full overflow-hidden rounded-full" aria-hidden="true">
				<div class="bg-primary h-full transition-all" style:width={`${total ? ((counts.landed + counts.failed) / total) * 100 : 0}%`}></div>
			</div>
			{#if !session.persistent}{@render downloadOnly()}{/if}
			{#if session.error}<p class="text-destructive text-sm">{session.error}</p>{/if}
			<Table.Root data-slot="apply-lines">
				<Table.Header>
					<Table.Row>
						<Table.Head>Entity</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Error</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each session.lines as line (line.key)}
						<Table.Row data-state={line.state}>
							<Table.Cell class="font-medium">{line.label}</Table.Cell>
							<Table.Cell><LineState state={line.state} /></Table.Cell>
							<Table.Cell class="text-destructive whitespace-normal">{line.error ?? ''}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{:else if !summary || run.plans.length === 0}
		<div class="flex flex-col items-start gap-2 p-6">
			<p class="text-muted-foreground text-sm">No plan yet. Choose the entities and review the plan first.</p>
			<Button size="sm" href="/plan">Plan</Button>
		</div>
	{:else}
		<div class="flex max-w-3xl flex-col gap-5 overflow-auto p-6" data-slot="apply-summary">
			<div>
				<h1 class="text-base font-semibold">Apply {run.template?.code} to {summary.entities} {summary.entities === 1 ? 'entity' : 'entities'}</h1>
				<p class="text-muted-foreground text-sm">{run.project?.name ?? `Project ${run.project?.id}`} · the last look before anything is written.</p>
			</div>
			<dl class="grid grid-cols-5 gap-4 text-sm" data-slot="apply-totals">
				{#each KINDS as kind (kind)}
					<div>
						<dt class="text-muted-foreground capitalize">{kind}</dt>
						<dd class="font-mono text-lg tabular-nums" data-slot={`total-${kind}`}>{summary.totals[kind]}</dd>
					</div>
				{/each}
			</dl>
			<section class="flex flex-col gap-1">
				<h2 class="text-sm font-medium">What will be written</h2>
				<ul class="list-disc space-y-0.5 pl-5 text-sm" data-slot="apply-writes">
					{#each summaryLines(summary) as text, i (i)}<li>{text}</li>{/each}
				</ul>
			</section>
			<section class="flex flex-col gap-1">
				<h2 class="text-sm font-medium">Undo</h2>
				{#each note.lines as text, i (i)}<p class="text-muted-foreground text-sm">{text}</p>{/each}
			</section>
			{#if !session.persistent}{@render downloadOnly()}{/if}
			{#if blockers.length}
				<ul class="text-destructive list-disc space-y-0.5 pl-5 text-sm" data-slot="apply-blockers">
					{#each blockers as text, i (i)}<li>{text}</li>{/each}
				</ul>
				<Button size="sm" variant="outline" href="/plan" class="self-start">Back to the plan</Button>
			{:else}
				<label class="flex items-center gap-2 text-sm">
					<Checkbox bind:checked={confirmed} aria-label="Confirm the write" />
					Write this to {summary.toWrite} {summary.toWrite === 1 ? 'entity' : 'entities'} on the site.
				</label>
				<div class="flex gap-2">
					<Button onclick={() => void session.start()} disabled={!confirmed}>Apply</Button>
					<Button variant="ghost" href="/plan">Back to the plan</Button>
				</div>
			{/if}
		</div>
	{/if}
{/await}
