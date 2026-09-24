<!--
	Entities: which of the type's entities the run touches. One list, filtered by template: all, this
	one, another, none. It opens on this one when an entity uses it, else on all; nothing is
	pre-selected. Filterable by code, every word required; select all reaches every page. Next reads
	and plans them, checks access, and opens the plan. Nothing here writes.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Search from '@lucide/svelte/icons/search';
	import { createEntitySource, resolveColumns, type CollectionColumn } from 'sg-widgets-core';
	import { liveContext } from '$lib/live';
	import { run, type ListFilter } from '$lib/app/run.svelte';
	import { entityListFilters, onlySelected, openingFilter, planBlocker, selectionLine } from '$lib/pure/entry';
	import { columnsKeyFor, defaultColumns, taskCount } from '$lib/pure/columns';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Notice from '$lib/app/notice.svelte';
	import Segmented from '$lib/app/segmented.svelte';
	import EntityTable from '$lib/components/entity-table.svelte';
	import FieldValue from '$lib/components/field-value.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';

	const FILTERS: Array<{ value: ListFilter; label: string }> = [
		{ value: 'all', label: 'All' },
		{ value: 'using', label: 'Using this template' },
		{ value: 'other', label: 'Other template' },
		{ value: 'none', label: 'No template' }
	];

	const started = run.start();

	let search = $state('');
	let query = $state('');
	$effect(() => {
		const next = search;
		const timer = setTimeout(() => (query = next), 250);
		return () => clearTimeout(timer);
	});

	/** The type is picked on Template; this page is rebuilt when it changes. */
	const entityType = untrack(() => run.entityType);
	const projectId = untrack(() => run.project?.id ?? null);
	/** Show selected lists the picks alone, whatever the list filter says. */
	let showSelected = $state(false);
	$effect(() => {
		if (run.selected.length === 0) showSelected = false;
	});
	const filters = $derived(
		projectId === null
			? null
			: showSelected
				? onlySelected(projectId, run.selected)
				: entityListFilters(projectId, run.listFilter ?? 'all', run.templateId, query)
	);
	/** How many picks the list filter matches; the rest are hidden by it. */
	let shown = $state<number | null>(null);
	$effect(() => {
		void run.listFilter;
		void run.templateId;
		const text = query;
		const picked = run.selected;
		if (showSelected || picked.length === 0) {
			shown = picked.length === 0 ? null : picked.length;
			return;
		}
		let live = true;
		run.countSelectedShown(text).then(
			(value) => live && (shown = value),
			() => live && (shown = null)
		);
		return () => {
			live = false;
		};
	});
	const line = $derived(selectionLine(run.selected.length, shown));
	/** How many entities the list filter matches: the count on Select all. */
	let matching = $state<number | null>(null);
	$effect(() => {
		const filter = run.listFilter;
		void run.templateId;
		const text = query;
		matching = null;
		if (filter === null) return;
		let live = true;
		run.countMatching(filter, text).then(
			(value) => live && (matching = value),
			() => live && (matching = null)
		);
		return () => {
			live = false;
		};
	});
	let source = $state.raw<ReturnType<typeof createEntitySource> | null>(null);
	let columns = $state<CollectionColumn[]>([]);
	let selectingAll = $state(false);
	let selectError = $state<string | null>(null);

	const blocker = $derived(planBlocker({ project: run.project, entityType: run.entityType, template: run.template, selected: run.selected.length }));
	const isDefault = $derived(run.defaultTemplate.state === 'ready' && run.defaultTemplate.value?.id === run.templateId);
	const planning = $derived(run.planning.state === 'loading');
	const count = $derived(run.selected.length);

	onMount(() => {
		void started.then(async () => {
			if (run.problem || !entityType || projectId === null) return;
			const context = liveContext();
			if (run.listFilter === null) {
				const using = await run.countMatching('using', '').catch(() => null);
				run.setListFilter(openingFilter(using ?? 0));
			}
			// The type's defaults, keeping the fields its schema has; the user's pick replaces them.
			const specs = defaultColumns(entityType, await context.schema.fields(entityType));
			source = createEntitySource({
				client: context.client,
				entityType,
				fields: [...new Set(['code', 'task_template', ...specs.map((spec) => spec.path)])],
				filters: untrack(() => filters),
				sort: [{ path: 'code', descending: false }],
				pageSize: 100,
				mode: 'infinite'
			});
			columns = await resolveColumns(context.schema, entityType, specs);
		});
	});

	async function selectAll(): Promise<void> {
		selectingAll = true;
		selectError = null;
		try {
			await run.selectAllMatching(query);
		} catch (error) {
			selectError = error instanceof Error ? error.message : String(error);
		} finally {
			selectingAll = false;
		}
	}

	async function next(): Promise<void> {
		if (await run.buildPlans()) void goto('/plan');
	}
</script>

<svelte:head><title>Entities · SG Task Templates</title></svelte:head>

{#await started}
	<PageState state="loading" title="Reaching the site…" />
{:then}
	{#if run.problem}
		<PageState state="error" title="Not connected" line={run.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else if !run.project || !entityType || run.templateId === null}
		<PageState state="empty" title="No template yet" line="Pick a project, an entity type and a template first.">
			{#snippet action()}<Button href="/template">Template</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader title="Entities">
			{#snippet context()}
				<span>{run.project?.name ?? `Project ${run.project?.id}`}</span>
				<span aria-hidden="true">·</span>
				<span>{entityType}</span>
				<span aria-hidden="true">·</span>
				<a href="/template" class="text-foreground font-medium underline-offset-4 hover:underline">{run.template?.code ?? `Template ${run.templateId}`}</a>
				{#if isDefault}<span>(project default)</span>{/if}
			{/snippet}
			{#snippet actions()}
				{#if planning}
					<span class="text-muted-foreground text-sm tabular-nums" data-slot="planning-progress">
						Reading {run.planning.state === 'loading' ? (run.planning.done ?? 0) : 0} of {run.planning.state === 'loading' ? (run.planning.total ?? count) : count}…
					</span>
				{:else if blocker}
					<span class="text-muted-foreground text-sm">{blocker}</span>
				{/if}
				<Button onclick={() => void next()} disabled={blocker !== null || planning}>
					{planning ? 'Planning…' : count > 0 ? `Plan ${count} ${count === 1 ? 'entity' : 'entities'}` : 'Plan'}
					<ArrowRight data-icon="inline-end" />
				</Button>
			{/snippet}
			{#if run.planning.state === 'error'}
				<Notice tone="destructive" title="Could not build the plan." data-slot="planning-error">{' '}{run.planning.message}</Notice>
			{/if}
		</PageHeader>

		<div class="border-border flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-3" data-slot="entity-picks">
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground text-xs font-medium" aria-hidden="true">Show</span>
				<Segmented
					label="Show"
					value={run.listFilter ?? ''}
					options={FILTERS}
					onChange={(value) => run.setListFilter(value as ListFilter)}
				/>
			</div>
			<div class="relative w-64">
				<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
				<Input class="h-8 pl-8" type="search" placeholder="Filter by code" bind:value={search} aria-label="Filter by code" />
			</div>
		</div>

		<div class="border-border bg-muted flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-2" data-slot="selection-bar">
			<span class="text-sm" data-slot="selected-count">
				<span class="font-semibold tabular-nums">{count}</span>
				<span class="text-muted-foreground">selected</span>
				{#if line.hidden > 0 && !showSelected}
					<span class="text-muted-foreground" data-slot="hidden-count">· <span class="tabular-nums">{line.hidden}</span> hidden by the filter</span>
				{/if}
			</span>
			<Button
				size="sm"
				variant="outline"
				aria-pressed={showSelected}
				data-slot="show-selected"
				class="aria-pressed:bg-accent aria-pressed:text-accent-foreground"
				onclick={() => (showSelected = !showSelected)}
				disabled={count === 0}
			>
				Show selected
			</Button>
			<Button size="sm" variant="outline" onclick={() => void selectAll()} disabled={selectingAll}>
				{selectingAll ? 'Selecting…' : matching === null ? 'Select all' : `Select all ${matching}`}
			</Button>
			<Button size="sm" variant="ghost" onclick={() => run.setSelected([])} disabled={count === 0}>Clear</Button>
			{#if selectError}<span class="text-destructive text-sm">{selectError}</span>{/if}
		</div>

		<div class="flex min-h-0 flex-1 flex-col px-6 py-4">
			{#if source}
				<EntityTable
					{source}
					bind:columns
					context={liveContext()}
					projectId={run.project.id}
					{filters}
					selectable
					selection={run.selected}
					onSelectionChange={(rows) => run.setSelected(rows)}
					onSelectAllMatching={selectAll}
					columnPicker
					columnsKey={columnsKeyFor(run.project.id, entityType)}
					paging="scroll"
					maxHeight="100%"
					density="compact"
					class="min-h-0 flex-1"
				>
					{#snippet cell({ column, value })}
						{#if column.path === 'tasks'}
							<span class="font-mono text-xs tabular-nums">{taskCount(value) ?? ''}</span>
						{:else}
							<FieldValue {value} dataType={column.dataType} field={column.field} context={liveContext()} density="compact" />
						{/if}
					{/snippet}
				</EntityTable>
			{/if}
		</div>
	{/if}
{/await}
