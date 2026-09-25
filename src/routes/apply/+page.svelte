<!--
	Apply: the run in progress, started from the plan's confirm dialog. One atomic batch per entity,
	about four in flight, a live line each. Cancel stops after the entities in flight; at the end, See
	the result. Logic in `$lib/pure/apply-view.ts`, state in `$lib/app/apply.svelte.ts`. Layout: one
	column `max-w-3xl` (docs/design.md).
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import { run } from '$lib/app/run.svelte';
	import { session } from '$lib/app/apply.svelte';
	import LineState from '$lib/app/line-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import UndoDownloadOnly from '$lib/app/undo-download-only.svelte';
	import { applyTitle, canCancel, lineCounts } from '$lib/pure/apply-view';
	import { localTime } from '$lib/pure/time';
	import { Button } from '$lib/components/ui/button/index.js';

	const started = run.start();
	onMount(() => void session.open());

	const counts = $derived(lineCounts(session.lines));
	const total = $derived(session.lines.length);
	const done = $derived(counts.landed + counts.failed);
	const showRun = $derived(session.phase === 'running' || (session.phase === 'done' && session.source === run.plans && session.current !== null));
</script>

<svelte:head><title>Apply · SG Task Templates</title></svelte:head>

{#await started}
	<PageState state="loading" title="Connecting to Flow PT…" />
{:then}
	{#if run.problem}
		<PageState state="error" title="Cannot connect to Flow PT" line={run.problem}>
			{#snippet action()}<Button size="sm" href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else if session.starting}
		<PageState state="loading" title="Starting the run" />
	{:else if showRun && session.current}
		{@const current = session.current}
		<PageHeader title={applyTitle(session.phase === 'running' ? 'running' : 'done', counts)}>
			{#snippet context()}
				<span>{current.project.name ?? `Project ${current.project.id}`}</span>
				<span aria-hidden="true">·</span>
				<span class="text-foreground font-medium">{current.template.code}</span>
				<span aria-hidden="true">·</span>
				<span class="tabular-nums">started {localTime(current.startedAt)}</span>
			{/snippet}
			{#snippet actions()}
				{#if session.phase === 'running'}
					{#if canCancel(counts) || session.stopping}
						<Button variant="outline" onclick={() => session.cancel()} disabled={session.stopping}>
							{session.stopping ? 'Stopping after current…' : 'Cancel after current'}
						</Button>
					{:else}
						<span class="text-muted-foreground text-sm" data-slot="cancel-none">Every entity has started.</span>
					{/if}
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
				{#if !session.persistent}<UndoDownloadOnly />{/if}
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
	{:else}
		<PageState state="empty" icon={ListChecks} title="No run yet" line={session.error ?? 'Apply on the plan starts one.'}>
			{#snippet action()}<Button size="sm" href="/plan">Go to the plan</Button>{/snippet}
		</PageState>
	{/if}
{/await}
