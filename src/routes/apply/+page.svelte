<!--
	Apply: the last summary (the five totals, what will be written, where undo lives), the final
	confirm beside the primary, then the run: one atomic batch per entity, about four in flight, a
	live line each. Cancel stops after the entities in flight. Logic in `$lib/pure/apply-view.ts`,
	state in `$lib/app/apply.svelte.ts`. Layout: one column `max-w-3xl` (docs/design.md).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Download from '@lucide/svelte/icons/download';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { run } from '$lib/app/run.svelte';
	import { session } from '$lib/app/apply.svelte';
	import CountChips from '$lib/app/count-chips.svelte';
	import LineState from '$lib/app/line-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import { lineCounts, startBlockers, summaryGroups, undoNote, writeSummary } from '$lib/pure/apply-view';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';

	const started = run.start();
	onMount(() => void session.open());

	let confirmed = $state(false);
	const summary = $derived(run.options ? writeSummary(run.plans, run.options) : null);
	const blockers = $derived(run.options ? startBlockers(run.plans, run.options) : []);
	const note = $derived(undoNote(session.persistent));
	const counts = $derived(lineCounts(session.lines));
	const total = $derived(session.lines.length);
	const done = $derived(counts.landed + counts.failed);
	const hasRecords = $derived(session.records().length > 0);
	const showRun = $derived(session.phase === 'running' || (session.phase === 'done' && session.source === run.plans && session.current !== null));

	const entities = (n: number) => `${n} ${n === 1 ? 'entity' : 'entities'}`;
	const time = (iso: string) => iso.slice(0, 16).replace('T', ' ');
</script>

<svelte:head><title>Apply · SG Task Templates</title></svelte:head>

{#snippet downloadOnly()}
	<Notice tone="warning" title="Undo is download-only in this browser. " data-slot="undo-download-only">
		It cannot store the undo record: it lives in this tab only. Download it as entities land, and before you close the tab.
		{#snippet action()}
			<Button size="sm" variant="outline" onclick={() => session.download()} disabled={!hasRecords}>
				<Download data-icon="inline-start" />
				{hasRecords ? 'Download undo record' : 'Download once an entity lands'}
			</Button>
		{/snippet}
	</Notice>
{/snippet}

{#await started}
	<PageState state="loading" title="Reaching the site…" />
{:then}
	{#if run.problem}
		<PageState state="error" title="Cannot reach the site" line={run.problem}>
			{#snippet action()}<Button size="sm" href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else if showRun && session.current}
		{@const current = session.current}
		<PageHeader title={session.phase === 'running' ? 'Applying' : 'Applied'}>
			{#snippet context()}
				<span>{current.project.name ?? `Project ${current.project.id}`}</span>
				<span aria-hidden="true">·</span>
				<span class="text-foreground font-medium">{current.template.code}</span>
				<span aria-hidden="true">·</span>
				<span class="tabular-nums">started {time(current.startedAt)}</span>
			{/snippet}
			{#snippet actions()}
				{#if session.phase === 'running'}
					<Button variant="outline" onclick={() => session.cancel()} disabled={session.stopping}>
						{session.stopping ? 'Stopping after current…' : 'Cancel after current'}
					</Button>
				{:else}
					<Button onclick={() => goto('/result')}>See the result <ArrowRight data-icon="inline-end" /></Button>
				{/if}
			{/snippet}
		</PageHeader>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="apply-run">
			<div class="flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
				<div class="flex flex-col gap-2" data-slot="apply-run-progress">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-medium tabular-nums" data-slot="apply-progress">{done} of {total} done</span>
						<span class="mr-auto"></span>
						<LineState state="landed" count={counts.landed} />
						<LineState state="failed" count={counts.failed} />
						{#if counts.landing}<LineState state="landing" count={counts.landing} />{/if}
						{#if counts.pending}<LineState state="pending" count={counts.pending} />{/if}
						{#if counts.cancelled}<LineState state="cancelled" count={counts.cancelled} />{/if}
					</div>
					<div
						class="bg-muted h-1.5 w-full overflow-hidden rounded-full"
						role="progressbar"
						aria-label="Entities done"
						aria-valuemin={0}
						aria-valuemax={total}
						aria-valuenow={done}
					>
						<div class="bg-primary h-full transition-all" style:width={`${total ? (done / total) * 100 : 0}%`}></div>
					</div>
				</div>
				{#if !session.persistent}{@render downloadOnly()}{/if}
				{#if session.error}<Notice tone="destructive">{session.error}</Notice>{/if}
				<Section title="Entities" meta={`${total}`}>
					<ul class="bg-card text-card-foreground divide-border divide-y rounded-lg border" data-slot="apply-lines">
						{#each session.lines as line (line.key)}
							<li class="flex flex-col gap-0.5 px-3 py-1.5" data-state={line.state}>
								<div class="flex items-center gap-2">
									<span class="min-w-0 flex-1 truncate text-sm font-medium" title={line.label}>{line.label}</span>
									<LineState state={line.state} />
								</div>
								{#if line.error}<p class="text-destructive text-xs break-words">{line.error}</p>{/if}
							</li>
						{/each}
					</ul>
				</Section>
			</div>
		</div>
	{:else if !summary || run.plans.length === 0}
		<PageState state="empty" icon={ListChecks} title="No plan yet" line="Choose the entities and review the plan first. Nothing is written before this screen.">
			{#snippet action()}<Button size="sm" href="/plan">Go to the plan</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader title="Apply">
			{#snippet context()}
				<span>{run.project?.name ?? `Project ${run.project?.id}`}</span>
				{#if run.entityType}<span aria-hidden="true">·</span><span>{run.entityType}</span>{/if}
				<span aria-hidden="true">·</span>
				<a href="/template" class="text-foreground font-medium underline-offset-4 hover:underline">{run.template?.code ?? `Template ${run.templateId}`}</a>
				<span aria-hidden="true">·</span>
				<span>the last look before anything is written</span>
			{/snippet}
			{#snippet actions()}
				<Button variant="ghost" href="/plan">Back to the plan</Button>
				{#if !blockers.length}
					<label class="flex items-center gap-2 text-sm" data-slot="apply-confirm">
						<Checkbox bind:checked={confirmed} aria-label="Confirm the write" />
						Write to {entities(summary.toWrite)} on the site
					</label>
				{/if}
				<Button onclick={() => void session.start()} disabled={!confirmed || blockers.length > 0}>
					Apply to {entities(summary.toWrite)}
				</Button>
			{/snippet}
		</PageHeader>
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="apply-summary">
			<div class="flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
				{#if blockers.length}
					<Notice tone="destructive" title="Cannot start yet. " data-slot="apply-blockers">
						{blockers.join(' ')}
						{#snippet action()}<Button size="sm" variant="outline" href="/plan">Fix on the plan</Button>{/snippet}
					</Notice>
				{/if}
				{#if !session.persistent}{@render downloadOnly()}{/if}
				<Section
					title="The plan"
					meta={summary.nothingToWrite ? `${entities(summary.entities)} · ${summary.toWrite} to write` : entities(summary.entities)}
					card
					data-slot="apply-totals"
				>
					<CountChips counts={summary.totals} />
				</Section>
				<Section title="What will be written" card>
					<div class="flex flex-col gap-4" data-slot="apply-writes">
						{#each summaryGroups(summary) as group (group.title)}
							<div class="flex flex-col gap-1.5">
								<h3 class="text-muted-foreground text-xs font-medium">{group.title}</h3>
								<ul class="marker:text-muted-foreground flex list-disc flex-col gap-1 pl-5 text-sm">
									{#each group.lines as text, i (i)}<li>{text}</li>{/each}
								</ul>
							</div>
						{/each}
					</div>
				</Section>
				<Section title="Undo" card>
					<div class="flex items-start gap-3">
						<Undo2 class="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden="true" />
						<div class="flex flex-col gap-1 text-sm">
							{#each note.lines as text, i (i)}<p class={i === 0 ? '' : 'text-muted-foreground'}>{text}</p>{/each}
							<p class="text-muted-foreground">Undo runs from the result screen, for the whole run or one entity.</p>
						</div>
					</div>
				</Section>
			</div>
		</div>
	{/if}
{/await}
