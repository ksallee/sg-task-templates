<!--
	The plan, always shown before a write (brief 9): the header with Apply and what blocks it, the run
	summary (what Apply does; each line filters the entities), the run options (collapsed to one
	line), the entity list with one outcome line each on the left, the selected entity's Tasks on the
	right (plan-summary.ts). While `run.buildPlans` reads, their progress (plan-view `planningStep`);
	the plan shows once they end and Apply waits on the access check (plan-view `applyGate`). Every choice re-plans
	through `run.setOptions`; the logic is in `$lib/pure/plan-view.ts`. Nothing here writes. Apply
	opens its confirm dialog once nothing blocks it (apply-confirm.ts); Confirm starts the run and
	opens /apply.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { run } from '$lib/app/run.svelte';
	import { session } from '$lib/app/apply.svelte';
	import ApplyDialog from '$lib/app/plan/apply-dialog.svelte';
	import { applyConfirm } from '$lib/pure/apply-confirm';
	import RunOptions from '$lib/app/plan/run-options.svelte';
	import RunSummary from '$lib/app/plan/run-summary.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Download from '@lucide/svelte/icons/download';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import EntityDetail from '$lib/app/plan/entity-detail.svelte';
	import EntityList from '$lib/app/plan/entity-list.svelte';
	import { planToCsv } from '$lib/pure/csv';
	import { planTotals } from '$lib/pure/entry';
	import { acceptPicks, accessWarningText, applyBlockers, applyGate, openConflicts, planningStep, planCsvName } from '$lib/pure/plan-view';
	import { matchesKey, planSummary, type SummaryKey } from '$lib/pure/plan-summary';
	import type { EntityTask, Id, RunOptions as Options } from '$lib/pure/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	let summaryKey = $state<SummaryKey | null>(null);
	let text = $state('');
	let selectedId = $state<Id | null>(null);
	let optionsOpen = $state(false);
	let applying = $state(false);

	onMount(() => void session.open());

	const options = $derived(run.options);
	const step = $derived(planningStep(run.planning, run.entityType));
	const totals = $derived(planTotals(run.plans));
	const access = $derived(run.access.state === 'ready' ? run.access.value : null);
	const accessText = $derived(access ? accessWarningText(access) : null);
	const templates = $derived(run.templates.state === 'ready' ? run.templates.value : []);
	const tasksByEntity = $derived(Object.fromEntries(run.snapshots.map((s) => [s.entity.id, s.tasks])) as Record<Id, EntityTask[]>);
	const summary = $derived(
		options && run.template
			? planSummary({
					plans: run.plans,
					options,
					template: run.template,
					templates,
					tasks: tasksByEntity,
					entityType: run.entityType,
					labels: run.fieldLabels
				})
			: null
	);
	const activeLine = $derived(summary?.lines.find((l) => l.key === summaryKey) ?? null);
	const visible = $derived(
		run.plans.filter(
			(p) =>
				matchesKey(summary?.entities[p.entity.id], activeLine ? summaryKey : null) &&
				(!text.trim() || (p.entity.name ?? '').toLowerCase().includes(text.trim().toLowerCase()))
		)
	);
	const selected = $derived(run.plans.find((p) => p.entity.id === selectedId) ?? visible[0] ?? null);
	const selectedTasks = $derived(run.snapshots.find((s) => s.entity.id === selected?.entity.id)?.tasks ?? []);
	const blockers = $derived(options && run.ctx ? applyBlockers(run.plans, options, run.ctx, access) : []);
	const gate = $derived(applyGate(blockers, run.access));
	const conflictsOpen = $derived(options ? openConflicts(run.plans, options) > 0 : false);
	const entityNoun = $derived(totals.entities === 1 ? (run.entityType ?? 'entity') : run.entityType ? `${run.entityType}s` : 'entities');
	const filtered = $derived(activeLine !== null || text.trim() !== '');

	const confirmContent = $derived(options ? applyConfirm(run.plans, options, run.entityType, run.fieldLabels) : null);

	function confirmApply(): void {
		applying = false;
		void session.start();
		void goto('/apply');
	}

	function setOptions(next: Options): void {
		run.setOptions(next);
	}

	function download(): void {
		if (!run.template) return;
		const blob = new Blob([planToCsv(run.plans, run.template, run.fieldLabels)], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = planCsvName(run.template.code, new Date());
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head><title>Plan · SG Task Templates</title></svelte:head>

{#if step}
	<PageState state="loading" title="Building the plan" line={step} />
{:else if run.planning.state === 'error'}
	<PageState state="error" title="Could not build the plan" line={run.planning.message}>
		{#snippet action()}<Button href="/entities">Entities</Button>{/snippet}
	</PageState>
{:else if run.plans.length === 0 || !options || !run.template || !run.ctx}
	<PageState state="empty" title="No plan yet" line="Choose the entities, then Next.">
		{#snippet action()}<Button href="/entities">Entities</Button>{/snippet}
	</PageState>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<PageHeader title="Plan">
			{#snippet context()}
				<span>{run.project?.name ?? `Project ${run.project?.id}`}</span>
				<span aria-hidden="true">·</span>
				<a href="/template" class="text-foreground font-medium underline-offset-4 hover:underline">{run.template?.code}</a>
				<ArrowRight class="size-3.5" aria-label="to" />
				<a href="/entities" class="text-foreground font-medium underline-offset-4 hover:underline" data-slot="plan-entities"
					>{totals.entities} {entityNoun}</a
				>
				{#if totals.noop > 0}<span>· {totals.noop} with nothing to write</span>{/if}
			{/snippet}
			{#snippet actions()}
				{#if gate.reason}
					<span class="text-muted-foreground flex max-w-64 items-center gap-1.5 text-sm" title={blockers.join(' ') || undefined} data-slot="apply-reason">
						{#if gate.checking}<LoaderCircle class="size-3.5 shrink-0 animate-spin" aria-hidden="true" />{/if}
						<span class="truncate">{gate.reason}</span>
					</span>
				{/if}
				<Button variant="outline" onclick={download}><Download data-icon="inline-start" />Download CSV</Button>
				<Button disabled={gate.blocked} onclick={() => (applying = true)} title={gate.reason ?? undefined}>
					Apply<ArrowRight data-icon="inline-end" />
				</Button>
			{/snippet}
			{#if blockers.length > 0}
				<Notice tone="destructive" title="Before Apply:" data-slot="apply-blockers">
					{#each blockers as b, i (b)}{i > 0 ? ' · ' : ' '}{b}{/each}
					{#snippet action()}
						{#if conflictsOpen}
							<Button size="sm" variant="outline" onclick={() => setOptions(acceptPicks(options, run.plans))}>Accept all pre-picks</Button>
						{/if}
					{/snippet}
				</Notice>
			{/if}
			{#if accessText}
				<Notice tone="destructive" data-slot="access-short">{accessText}</Notice>
			{:else if run.access.state === 'error'}
				<Notice tone="warning" title="The access check failed: " data-slot="access-error">{run.access.message}</Notice>
			{/if}
		</PageHeader>

		{#if summary}<RunSummary lines={summary.lines} active={activeLine ? summaryKey : null} onFilter={(k) => (summaryKey = k)} />{/if}

		<RunOptions
			labels={run.fieldLabels}
			template={run.template}
			plans={run.plans}
			ctx={run.ctx}
			{options}
			onOptions={setOptions}
			open={optionsOpen}
			onToggle={() => (optionsOpen = !optionsOpen)}
		>
			{#snippet footer()}
				<p class="text-muted-foreground text-xs" data-slot="plan-warnings">
					{#if access && !access.looksShort}<span data-slot="access-ok">Write access: no refusal seen.</span>
					{/if}
				</p>
			{/snippet}
		</RunOptions>

		<div class="flex min-h-0 flex-1">
			<aside class="border-border flex w-80 shrink-0 flex-col border-r" data-slot="plan-left" aria-label="Entities">
				<div class="border-border flex flex-col gap-2 border-b px-3 py-3" data-slot="plan-filters">
					<div class="relative">
						<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
						<Input class="h-8 pl-8" type="search" placeholder="Filter by code" bind:value={text} aria-label="Filter by code" />
					</div>
					{#if activeLine}
						<div class="border-primary/40 bg-primary/10 flex items-start gap-2 rounded-md border px-2 py-1 text-xs" data-slot="summary-filter">
							<span class="min-w-0 flex-1">{activeLine.text}</span>
							<button type="button" class="text-muted-foreground hover:text-foreground shrink-0" aria-label="Clear this filter" onclick={() => (summaryKey = null)}
								><X class="size-3.5" /></button
							>
						</div>
					{/if}
					<div class="flex items-center gap-2">
						<p class="text-muted-foreground text-xs tabular-nums">{visible.length} of {run.plans.length} entities</p>
						{#if filtered}
							<Button
								size="xs"
								variant="ghost"
								class="ml-auto"
								onclick={() => {
									summaryKey = null;
									text = '';
								}}>Clear filters</Button
							>
						{/if}
					</div>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<EntityList plans={visible} summaries={summary?.entities ?? {}} {options} selected={selected?.entity.id ?? null} onSelect={(id) => (selectedId = id)} />
				</div>
			</aside>
			<main class="min-h-0 flex-1 overflow-y-auto">
				{#if selected && summary?.entities[selected.entity.id]}
					<EntityDetail
						plan={selected}
						summary={summary.entities[selected.entity.id]}
						template={run.template}
						tasks={selectedTasks}
						{options}
						onOptions={setOptions}
					/>
				{/if}
			</main>
		</div>
	</div>

	{#if confirmContent}
		<ApplyDialog bind:open={applying} content={confirmContent} persistent={session.persistent} onConfirm={confirmApply} />
	{/if}
{/if}
