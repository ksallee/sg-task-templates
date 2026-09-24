<!--
	The plan, always shown before a write (brief 9): bulk actions on top, the entity list with its five
	counts on the left, the selected entity's Tasks and edges on the right. Every choice re-plans
	through `run.setOptions`; the logic is in `$lib/pure/plan-view.ts`. Nothing here writes. Apply
	opens /apply once nothing blocks it.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { run } from '$lib/app/run.svelte';
	import BulkBar from '$lib/app/plan/bulk-bar.svelte';
	import EntityDetail from '$lib/app/plan/entity-detail.svelte';
	import EntityList from '$lib/app/plan/entity-list.svelte';
	import { planToCsv } from '$lib/pure/csv';
	import { planTotals } from '$lib/pure/entry';
	import {
		NO_FILTER,
		PLAN_KINDS,
		acceptPicks,
		accessWarningText,
		applyBlockers,
		filterPlans,
		pendingDeletes,
		planCsvName,
		withDeleteConfirmed,
		type EntityFilter
	} from '$lib/pure/plan-view';
	import type { Id, PlanKind, RunOptions } from '$lib/pure/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';

	let filter = $state<EntityFilter>({ ...NO_FILTER });
	let selectedId = $state<Id | null>(null);
	let confirming = $state(false);
	let bulkOpen = $state(true);

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

	function setOptions(next: RunOptions): void {
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
	<div class="flex flex-col items-start gap-2 p-6">
		<p class="text-muted-foreground text-sm">No plan yet. Choose the entities, then Next.</p>
		<Button size="sm" href="/entities">Entities</Button>
	</div>
{:else}
	<div class="flex min-h-0 flex-1 flex-col">
		<div class="border-border flex shrink-0 flex-col gap-2 border-b px-4 py-2" data-slot="plan-top">
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<p class="text-sm">
					<span class="font-medium">{run.template.code}</span>
					<span class="text-muted-foreground">on {totals.entities} {totals.entities === 1 ? 'entity' : 'entities'}, {totals.noop} no-op</span>
				</p>
				<dl class="flex gap-3 font-mono text-xs tabular-nums" data-slot="plan-totals">
					{#each PLAN_KINDS as kind (kind)}
						<div class="flex gap-1"><dt class="text-muted-foreground">{kind}</dt><dd data-slot={`count-${kind}`}>{totals[kind]}</dd></div>
					{/each}
				</dl>
				<span class="mr-auto"></span>
				<Button size="sm" variant="ghost" onclick={() => (bulkOpen = !bulkOpen)}>{bulkOpen ? 'Hide' : 'Show'} bulk actions</Button>
				<Button size="sm" variant="outline" onclick={download}>Download CSV</Button>
				{#if conflictsOpen}
					<Button size="sm" variant="outline" onclick={() => setOptions(acceptPicks(options, run.plans))}>Accept all pre-picks</Button>
				{/if}
				{#if deletes.length > 0 && !options.deleteConfirmed}
					<Button size="sm" variant="destructive" onclick={() => (confirming = true)}>Confirm {deletes.length} delete{deletes.length === 1 ? '' : 's'}</Button>
				{/if}
				<Button size="sm" disabled={blockers.length > 0} onclick={() => void goto('/apply')} title={blockers.join(' ') || undefined}>Apply</Button>
			</div>

			{#if bulkOpen}<BulkBar template={run.template} plans={run.plans} ctx={run.ctx} {options} onOptions={setOptions} />{/if}

			<div class="flex flex-col gap-1 text-xs" data-slot="plan-warnings">
				{#if run.access.state === 'loading'}
					<p class="text-muted-foreground">Checking write access…</p>
				{:else if run.access.state === 'error'}
					<p class="text-warning">The access check failed: {run.access.message}</p>
				{:else if run.access.state === 'ready' && access && !access.looksShort}
					<p class="text-muted-foreground" data-slot="access-ok">Write access: no refusal seen (094 checks).</p>
				{/if}
				{#if accessText}
					<p class="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-2 py-1" data-slot="access-short">{accessText}</p>
				{/if}
				{#if blockers.length > 0}
					<p class="text-destructive" data-slot="apply-blockers">Apply waits: {blockers.join(' ')}</p>
				{/if}
			</div>
		</div>

		<div class="flex min-h-0 flex-1">
			<aside class="border-border flex w-80 shrink-0 flex-col border-r" data-slot="plan-left">
				<div class="border-border flex flex-col gap-2 border-b p-2">
					<Input class="h-8" type="search" placeholder="Filter by code" bind:value={filter.text} aria-label="Filter by code" />
					<ToggleGroup.Root
						type="multiple"
						size="sm"
						variant="outline"
						value={filter.kinds}
						onValueChange={(v) => (filter.kinds = v as PlanKind[])}
						aria-label="Show entities with"
					>
						{#each PLAN_KINDS as kind (kind)}
							<ToggleGroup.Item value={kind} class="px-1.5 text-xs">{kind}</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
					<div class="flex items-center gap-2">
						<ToggleGroup.Root
							type="single"
							size="sm"
							variant="outline"
							value={filter.noop}
							onValueChange={(v) => v && (filter.noop = v as EntityFilter['noop'])}
							aria-label="No-op entities"
						>
							<ToggleGroup.Item value="all" class="px-1.5 text-xs">all</ToggleGroup.Item>
							<ToggleGroup.Item value="hide" class="px-1.5 text-xs">hide no-op</ToggleGroup.Item>
							<ToggleGroup.Item value="only" class="px-1.5 text-xs">no-op only</ToggleGroup.Item>
						</ToggleGroup.Root>
						<ToggleGroup.Root
							type="multiple"
							size="sm"
							variant="outline"
							value={filter.warnings ? ['warnings'] : []}
							onValueChange={(v) => (filter.warnings = v.includes('warnings'))}
							aria-label="Warnings only"
						>
							<ToggleGroup.Item value="warnings" class="px-1.5 text-xs">⚠ only</ToggleGroup.Item>
						</ToggleGroup.Root>
					</div>
					<p class="text-muted-foreground text-xs tabular-nums">{visible.length} of {run.plans.length}</p>
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
