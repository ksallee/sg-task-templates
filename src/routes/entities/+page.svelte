<!--
	Entities: which of the type's entities the run touches. Three lists, one planner: the whole type
	(pick entities), those on the template (every entity using it), those with no template (the
	project default pre-selected, 088). Filterable by code; select all reaches every page. Next reads
	and plans them, checks access, and opens the plan. Nothing here writes.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { createEntitySource, resolveColumns, type CollectionColumn } from 'sg-widgets-core';
	import { liveContext } from '$lib/live';
	import { run, type EntryPoint } from '$lib/app/run.svelte';
	import { entityListFilters, planBlocker } from '$lib/pure/entry';
	import EntityTable from '$lib/components/entity-table.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';

	const ENTRIES: ReadonlyArray<{ value: EntryPoint; label: string }> = [
		{ value: 'template_first', label: 'Using this template' },
		{ value: 'entities_first', label: 'All' },
		{ value: 'no_template', label: 'No template' }
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
	const filters = $derived(projectId === null ? null : entityListFilters(projectId, run.entryPoint, run.templateId, query));
	let source = $state.raw<ReturnType<typeof createEntitySource> | null>(null);
	let columns = $state<CollectionColumn[]>([]);
	let selectingAll = $state(false);
	let selectError = $state<string | null>(null);

	const blocker = $derived(planBlocker({ project: run.project, entityType: run.entityType, template: run.template, selected: run.selected.length }));
	const isDefault = $derived(run.defaultTemplate.state === 'ready' && run.defaultTemplate.value?.id === run.templateId);

	onMount(() => {
		void started.then(async () => {
			if (run.problem || !entityType || projectId === null) return;
			const context = liveContext();
			source = createEntitySource({
				client: context.client,
				entityType,
				fields: ['code', 'task_template'],
				filters: untrack(() => filters),
				sort: [{ path: 'code', descending: false }],
				pageSize: 100,
				mode: 'infinite'
			});
			columns = await resolveColumns(context.schema, entityType, ['code', 'task_template']);
			// "Every entity using it" means every one: selected on arrival, across every page.
			if (run.entryPoint === 'template_first' && run.selected.length === 0 && run.templateId !== null) void selectAll();
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
	<p class="text-muted-foreground p-6 text-sm">Reaching the site…</p>
{:then}
	{#if run.problem}
		<div class="flex flex-col items-start gap-2 p-6">
			<p class="text-sm">{run.problem}</p>
			<Button size="sm" href="/connect">Connect</Button>
		</div>
	{:else if !run.project || !entityType || run.templateId === null}
		<div class="flex flex-col items-start gap-2 p-6">
			<p class="text-sm">Pick a project, an entity type and a template first.</p>
			<Button size="sm" href="/template">Template</Button>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col">
			<div class="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2" data-slot="entity-picks">
				<span class="text-sm">
					<span class="text-muted-foreground">{entityType} ·</span>
					<a href="/template" class="font-medium underline-offset-4 hover:underline">{run.template?.code ?? `Template ${run.templateId}`}</a>
					{#if isDefault}<span class="text-muted-foreground">(project default)</span>{/if}
				</span>
				<ToggleGroup.Root
					type="single"
					size="sm"
					variant="outline"
					value={run.entryPoint}
					onValueChange={(value) => value && run.setEntryPoint(value as EntryPoint)}
					aria-label="Which entities"
				>
					{#each ENTRIES as entry (entry.value)}
						<ToggleGroup.Item value={entry.value}>{entry.label}</ToggleGroup.Item>
					{/each}
				</ToggleGroup.Root>
				<Input class="h-8 w-56" type="search" placeholder="Filter by code" bind:value={search} aria-label="Filter by code" />
			</div>

			<div class="flex min-h-0 flex-1 flex-col p-4">
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
						paging="scroll"
						maxHeight="100%"
						density="compact"
						class="min-h-0 flex-1"
					/>
				{/if}
			</div>

			<footer class="border-border flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2" data-slot="entities-footer">
				<span class="text-sm tabular-nums" data-slot="selected-count">{run.selected.length} selected</span>
				<Button size="sm" variant="ghost" onclick={() => void selectAll()} disabled={selectingAll}>
					{selectingAll ? 'Selecting…' : 'Select all matching'}
				</Button>
				<Button size="sm" variant="ghost" onclick={() => run.setSelected([])} disabled={run.selected.length === 0}>Clear</Button>
				{#if selectError}<span class="text-destructive text-sm">{selectError}</span>{/if}
				<span class="mr-auto"></span>
				{#if run.planning.state === 'loading'}
					<span class="text-muted-foreground text-sm tabular-nums" data-slot="planning-progress">
						Reading {run.planning.done ?? 0} of {run.planning.total ?? run.selected.length}…
					</span>
				{:else if run.planning.state === 'error'}
					<span class="text-destructive text-sm" data-slot="planning-error">Could not build the plan: {run.planning.message}</span>
				{:else if blocker}
					<span class="text-muted-foreground text-sm">{blocker}</span>
				{/if}
				<Button size="sm" onclick={() => void next()} disabled={blocker !== null || run.planning.state === 'loading'}>Next: plan</Button>
			</footer>
		</div>
	{/if}
{/await}
