<!--
	The plan, always shown before a write (brief 9): the header with Apply and what blocks it, the run
	options (collapsed to one line), the entity list with its five counts on the left, the selected
	entity's Tasks and edges on the right. Every choice re-plans
	through `run.setOptions`; the logic is in `$lib/pure/plan-view.ts`. Nothing here writes. Apply
	opens /apply once nothing blocks it.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { run } from '$lib/app/run.svelte';
	import RunOptions from '$lib/app/plan/run-options.svelte';
	import CountChips from '$lib/app/count-chips.svelte';
	import { KINDS, KIND_DOT, KIND_LABEL } from '$lib/app/count-chip.svelte';
	import Notice from '$lib/app/notice.svelte';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Segmented from '$lib/app/segmented.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Download from '@lucide/svelte/icons/download';
	import Search from '@lucide/svelte/icons/search';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { cn } from '$lib/utils.js';
	import EntityDetail from '$lib/app/plan/entity-detail.svelte';
	import EntityList from '$lib/app/plan/entity-list.svelte';
	import { planToCsv } from '$lib/pure/csv';
	import { planTotals } from '$lib/pure/entry';
	import {
		NO_FILTER,
		acceptPicks,
		accessWarningText,
		applyBlockers,
		filterPlans,
		pendingDeletes,
		planCsvName,
		withDeleteConfirmed,
		type EntityFilter
	} from '$lib/pure/plan-view';
	import type { Id, RunOptions as Options } from '$lib/pure/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	let filter = $state<EntityFilter>({ ...NO_FILTER });
	let selectedId = $state<Id | null>(null);
	let confirming = $state(false);
	let optionsOpen = $state(false);

	const options = $derived(run.options);
	const totals = $derived(planTotals(run.plans));
	const access = $derived(run.access.state === 'ready' ? run.access.value : null);
	const accessText = $derived(access ? accessWarningText(access) : null);
	const visible = $derived(options ? filterPlans(run.plans, filter, options) : []);
	const selected = $derived(run.plans.find((p) => p.entity.id === selectedId) ?? visible[0] ?? null);
	const selectedTasks = $derived(run.snapshots.find((s) => s.entity.id === selected?.entity.id)?.tasks ?? []);
	const blockers = $derived(options && run.ctx ? applyBlockers(run.plans, options, run.ctx, access) : []);
	const deletes = $derived(pendingDeletes(run.plans));
	const templates = $derived(run.templates.state === 'ready' ? run.templates.value : []);
	const conflictsOpen = $derived(blockers.some((b) => b.includes('conflict')));
	const entityNoun = $derived(totals.entities === 1 ? (run.entityType ?? 'entity') : run.entityType ? `${run.entityType}s` : 'entities');
	const filtered = $derived(filter.kinds.length > 0 || filter.warnings || filter.noop !== 'all' || filter.text.trim() !== '');

	function setOptions(next: Options): void {
		run.setOptions(next);
	}

	function download(): void {
		if (!run.template) return;
		const blob = new Blob([planToCsv(run.plans, run.template)], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = planCsvName(run.template.code, new Date());
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head><title>Plan · SG Task Templates</title></svelte:head>

{#if run.plans.length === 0 || !options || !run.template || !run.ctx}
	<PageState state="empty" title="No plan yet" line="Choose the entities, then Plan.">
		{#snippet action()}<Button href="/entities">Entities</Button>{/snippet}
	</PageState>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<PageHeader title="Plan">
			{#snippet context()}
				<span>{run.project?.name ?? `Project ${run.project?.id}`}</span>
				<span aria-hidden="true">·</span>
				<a href="/template" class="text-foreground font-medium underline-offset-4 hover:underline">{run.template?.code}</a>
				<ArrowRight class="size-3.5" aria-label="onto" />
				<a href="/entities" class="text-foreground font-medium underline-offset-4 hover:underline" data-slot="plan-entities"
					>{totals.entities} {entityNoun}</a
				>
				{#if totals.noop > 0}<span>· {totals.noop} no-op</span>{/if}
			{/snippet}
			{#snippet actions()}
				{#if blockers.length > 0}
					<span class="text-muted-foreground max-w-64 truncate text-sm" title={blockers.join(' ')} data-slot="apply-reason">{blockers[0]}</span>
				{/if}
				<Button variant="outline" onclick={download}><Download data-icon="inline-start" />Download CSV</Button>
				<Button disabled={blockers.length > 0} onclick={() => void goto('/apply')} title={blockers.join(' ') || undefined}>
					Apply<ArrowRight data-icon="inline-end" />
				</Button>
			{/snippet}
			<div class="flex flex-wrap items-center gap-x-3 gap-y-2" data-slot="plan-totals">
				<CountChips counts={totals} />
				<span class="text-muted-foreground text-xs">over every entity</span>
			</div>
			{#if blockers.length > 0}
				<Notice tone="destructive" title="Apply waits on:" data-slot="apply-blockers">
					{#each blockers as b, i (b)}{i > 0 ? ' · ' : ' '}{b}{/each}
					{#snippet action()}
						{#if conflictsOpen}
							<Button size="sm" variant="outline" onclick={() => setOptions(acceptPicks(options, run.plans))}>Accept all pre-picks</Button>
						{/if}
						{#if deletes.length > 0 && !options.deleteConfirmed}
							<Button size="sm" variant="destructive" onclick={() => (confirming = true)}>Confirm {deletes.length} delete{deletes.length === 1 ? '' : 's'}</Button>
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

		<RunOptions
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
					{#if run.access.state === 'loading'}Checking write access…
					{:else if access && !access.looksShort}<span data-slot="access-ok">Write access: no refusal seen (094 checks).</span>
					{/if}
				</p>
			{/snippet}
		</RunOptions>

		<div class="flex min-h-0 flex-1">
			<aside class="border-border flex w-80 shrink-0 flex-col border-r" data-slot="plan-left" aria-label="Entities">
				<div class="border-border flex flex-col gap-2 border-b px-3 py-3" data-slot="plan-filters">
					<div class="relative">
						<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
						<Input class="h-8 pl-8" type="search" placeholder="Filter by code" bind:value={filter.text} aria-label="Filter by code" />
					</div>
					<div class="flex items-center gap-1" role="group" aria-label="Show entities with">
						{#each KINDS as kind (kind)}
							{@const on = filter.kinds.includes(kind)}
							<button
								type="button"
								aria-pressed={on}
								title={`Entities with ${KIND_LABEL[kind].toLowerCase()} rows`}
								class={cn(
									'inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
									on ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
								)}
								onclick={() => (filter.kinds = on ? filter.kinds.filter((k) => k !== kind) : [...filter.kinds, kind])}
							>
								<span class={cn('size-1.5 rounded-full', KIND_DOT[kind])} aria-hidden="true"></span>{KIND_LABEL[kind]}
							</button>
						{/each}
					</div>
					<div class="flex items-center gap-2">
						<Segmented
							label="No-op entities"
							value={filter.noop}
							options={[
								{ value: 'all', label: 'All' },
								{ value: 'hide', label: 'Hide no-op' },
								{ value: 'only', label: 'Only no-op' }
							]}
							onChange={(v) => (filter.noop = v as EntityFilter['noop'])}
						/>
						<button
							type="button"
							aria-pressed={filter.warnings}
							class={cn(
								'ml-auto inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
								filter.warnings ? 'border-warning/60 bg-warning/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'
							)}
							onclick={() => (filter.warnings = !filter.warnings)}
						>
							<TriangleAlert class="text-warning size-3.5" aria-hidden="true" />Warnings
						</button>
					</div>
					<div class="flex items-center gap-2">
						<p class="text-muted-foreground text-xs tabular-nums">{visible.length} of {run.plans.length} entities</p>
						{#if filtered}
							<Button size="xs" variant="ghost" class="ml-auto" onclick={() => (filter = { ...NO_FILTER, kinds: [] })}>Clear filters</Button>
						{/if}
					</div>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto">
					<EntityList plans={visible} {options} selected={selected?.entity.id ?? null} onSelect={(id) => (selectedId = id)} />
				</div>
			</aside>
			<main class="min-h-0 flex-1 overflow-y-auto">
				{#if selected}
					<EntityDetail plan={selected} template={run.template} {templates} tasks={selectedTasks} {options} onOptions={setOptions} />
				{/if}
			</main>
		</div>
	</div>

	<Dialog.Root bind:open={confirming}>
		<Dialog.Content class="sm:max-w-xl">
			<Dialog.Header>
				<Dialog.Title>Delete {deletes.length} Task{deletes.length === 1 ? '' : 's'}?</Dialog.Title>
				<Dialog.Description>
					Deleting a Task unlinks its Versions and PublishedFiles and cuts its dependencies (089). Undo revives it.
				</Dialog.Description>
			</Dialog.Header>
			<ul class="flex max-h-72 flex-col gap-1 overflow-y-auto text-sm" data-slot="delete-list">
				{#each deletes as d (d.task.id)}
					{@const used = d.usage.versions + d.usage.publishedFiles > 0}
					<li class={used ? 'text-destructive font-medium' : ''}>
						{d.entity.name} · {d.task.content} #{d.task.id}: {d.usage.versions} Versions, {d.usage.publishedFiles} PublishedFiles
					</li>
				{/each}
			</ul>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (confirming = false)}>Cancel</Button>
				<Button
					variant="destructive"
					onclick={() => {
						setOptions(withDeleteConfirmed(options, true));
						confirming = false;
					}}>Delete them</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
