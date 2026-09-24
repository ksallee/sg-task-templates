<!--
	Template: the project, the entity type (only those with a task_template field), and the template,
	shown with its tasks and edges. Then one of the brief's entry points leads to Entities.
	Thin: the reads and the picks live in `$lib/app/run.svelte.ts`, the sorting in `$lib/pure/entry.ts`.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { liveContext } from '$lib/live';
	import { run, type EntryPoint } from '$lib/app/run.svelte';
	import { templateEdgeRows, templatesByType } from '$lib/pure/entry';
	import type { Template } from '$lib/pure/types';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import EntityTypePicker from '$lib/components/entity-type-picker.svelte';
	import StateLine from '$lib/components/state-line.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Table from '$lib/components/ui/table/index.js';

	const started = run.start();

	const groups = $derived(run.templates.state === 'ready' ? templatesByType(run.templates.value, run.entityType) : null);
	const defaultId = $derived(run.defaultTemplate.state === 'ready' ? (run.defaultTemplate.value?.id ?? null) : null);
	const edges = $derived(run.template ? templateEdgeRows(run.template) : []);

	function next(entry: EntryPoint): void {
		run.setEntryPoint(entry);
		void goto('/entities');
	}
</script>

<svelte:head><title>Template · SG Task Templates</title></svelte:head>

{#snippet item(t: Template)}
	<button
		type="button"
		class={[
			'focus-visible:ring-ring flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-visible:ring-2',
			t.id === run.templateId ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'
		].join(' ')}
		aria-pressed={t.id === run.templateId}
		onclick={() => run.setTemplate(t.id)}
	>
		<span class="truncate">{t.code}</span>
		<span class="text-muted-foreground shrink-0 text-xs tabular-nums">
			{#if t.id === defaultId}project default ·{/if}
			{t.tasks.length}
		</span>
	</button>
{/snippet}

{#await started}
	<p class="text-muted-foreground p-6 text-sm">Reaching the site…</p>
{:then}
	{#if run.problem}
		<div class="flex flex-col items-start gap-2 p-6">
			<p class="text-sm">{run.problem}</p>
			<Button size="sm" href="/connect">Connect</Button>
		</div>
	{:else}
		<div class="flex min-h-0 flex-1 flex-col">
			<div class="border-border flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2" data-slot="template-picks">
				<ProjectPicker
					context={liveContext()}
					value={run.project ? { type: 'Project', id: run.project.id, name: run.project.name } : null}
					onValueChange={(value) => run.setProject(value ? { id: value.id, name: value.name ?? undefined } : null)}
					class="w-64"
					size="sm"
				/>
				{#if !run.project}
					<span class="text-muted-foreground text-sm">Pick a project.</span>
				{:else if run.types.state === 'ready'}
					{#if run.types.value.length === 0}
						<span class="text-muted-foreground text-sm">No entity type in this project has a task template field.</span>
					{:else}
						<EntityTypePicker
							context={liveContext()}
							allow={run.types.value}
							value={run.entityType}
							onValueChange={(value) => run.setEntityType(value)}
							placeholder="Entity type"
							class="w-56"
							size="sm"
						/>
					{/if}
				{:else if run.types.state === 'error'}
					<span class="text-destructive text-sm">Could not read the entity types: {run.types.message}</span>
				{:else}
					<span class="text-muted-foreground text-sm" data-slot="types-loading">Reading which entity types take a template (once per session)…</span>
				{/if}
			</div>

			{#if run.project && run.entityType}
				<div class="flex min-h-0 flex-1">
					<aside class="border-border w-72 shrink-0 overflow-y-auto border-r p-2" aria-label="Templates" data-slot="template-list">
						{#if run.templates.state === 'error'}
							<StateLine state="error" label={`Could not read the templates: ${run.templates.message}`} />
						{:else if !groups}
							<div class="flex flex-col gap-2 p-2" aria-label="Reading the templates">
								<Skeleton class="h-6 w-full" />
								<Skeleton class="h-6 w-4/5" />
								<Skeleton class="h-6 w-3/5" />
							</div>
						{:else}
							{#if groups.matching.length === 0}
								<p class="text-muted-foreground px-2 py-1 text-sm">No template names {run.entityType}.</p>
							{/if}
							{#each groups.matching as t (t.id)}{@render item(t)}{/each}
							{#if groups.others.length > 0}
								<p class="text-muted-foreground mt-3 px-2 py-1 text-xs">Other types. Allowed; the plan warns.</p>
								{#each groups.others as t (t.id)}{@render item(t)}{/each}
							{/if}
						{/if}
					</aside>

					<section class="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Template detail">
						{#if run.template}
							{@const t = run.template}
							<div class="flex flex-col gap-4 p-4">
								<header class="flex flex-wrap items-baseline gap-2">
									<h1 class="text-base font-semibold">{t.code}</h1>
									<span class="text-muted-foreground text-sm">for {t.entityType ?? 'any type'}</span>
									{#if t.entityType !== run.entityType}
										<span class="text-sm font-medium">Not a {run.entityType} template: the plan will warn.</span>
									{/if}
								</header>

								<Table.Root data-slot="template-tasks">
									<Table.Header>
										<Table.Row>
											<Table.Head class="w-16 text-right">Order</Table.Head>
											<Table.Head>Task</Table.Head>
											<Table.Head>Step</Table.Head>
											<Table.Head class="text-right">Duration</Table.Head>
											<Table.Head class="text-right">Est. (min)</Table.Head>
											<Table.Head>Milestone</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each t.tasks as task (task.id)}
											<Table.Row>
												<Table.Cell class="text-right tabular-nums">{task.sortOrder ?? ''}</Table.Cell>
												<Table.Cell>{task.content ?? ''}</Table.Cell>
												<Table.Cell>{task.step?.name ?? ''}</Table.Cell>
												<Table.Cell class="text-right tabular-nums">{task.duration ?? ''}</Table.Cell>
												<Table.Cell class="text-right tabular-nums">{task.estInMins ?? ''}</Table.Cell>
												<Table.Cell>{task.milestone ? 'Yes' : ''}</Table.Cell>
											</Table.Row>
										{:else}
											<Table.Row><Table.Cell colspan={6} class="text-muted-foreground">No tasks.</Table.Cell></Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>

								<Table.Root data-slot="template-edges">
									<Table.Header>
										<Table.Row>
											<Table.Head>Upstream</Table.Head>
											<Table.Head>Downstream</Table.Head>
											<Table.Head>Type</Table.Head>
											<Table.Head class="text-right">Offset (working days)</Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{#each edges as edge, i (edge.id ?? i)}
											<Table.Row>
												<Table.Cell>{edge.upstream}</Table.Cell>
												<Table.Cell>{edge.downstream}</Table.Cell>
												<Table.Cell>{edge.type}</Table.Cell>
												<Table.Cell class="text-right tabular-nums">{edge.offsetDays ?? ''}</Table.Cell>
											</Table.Row>
										{:else}
											<Table.Row><Table.Cell colspan={4} class="text-muted-foreground">No dependencies.</Table.Cell></Table.Row>
										{/each}
									</Table.Body>
								</Table.Root>
							</div>
						{:else if groups}
							<p class="text-muted-foreground p-6 text-sm">Pick a template to see its tasks and dependencies.</p>
						{/if}
					</section>
				</div>

				<footer class="border-border flex shrink-0 flex-wrap items-center gap-2 border-t px-4 py-2" data-slot="entry-points">
					<span class="text-muted-foreground mr-auto text-sm">Then the entities:</span>
					<Button size="sm" variant="outline" disabled={!run.template} onclick={() => next('template_first')}>Every entity using it</Button>
					<Button size="sm" variant="outline" disabled={!run.template} onclick={() => next('entities_first')}>Pick entities</Button>
					<Button size="sm" variant="outline" disabled={!run.template && defaultId === null} onclick={() => next('no_template')}>
						Entities with no template
					</Button>
				</footer>
			{/if}
		</div>
	{/if}
{/await}
