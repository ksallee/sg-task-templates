<!--
	Template: the project, the entity type (only those with a task_template field), and the template,
	previewed as its tasks by step with what each waits on. Next leads to Entities. Thin: the reads and the picks live in `$lib/app/run.svelte.ts`, the sorting in
	`$lib/pure/entry.ts`, the preview in `$lib/pure/outline.ts`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
		import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Flag from '@lucide/svelte/icons/flag';
	import LayoutTemplate from '@lucide/svelte/icons/layout-template';
	import Search from '@lucide/svelte/icons/search';
	import { liveContext } from '$lib/live';
	import { run } from '$lib/app/run.svelte';
	import { templatesByType } from '$lib/pure/entry';
	import { templateOutline } from '$lib/pure/outline';
	import type { Template } from '$lib/pure/types';
	import PageHeader from '$lib/app/page-header.svelte';
	import PageState from '$lib/app/page-state.svelte';
	import Section from '$lib/app/section.svelte';
	import Notice from '$lib/app/notice.svelte';
	import ProjectPicker from '$lib/components/project-picker.svelte';
	import EntityTypePicker from '$lib/components/entity-type-picker.svelte';
	import StateLine from '$lib/components/state-line.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	const started = run.start();

	let query = $state('');
	const groups = $derived(run.templates.state === 'ready' ? templatesByType(run.templates.value, run.entityType, query) : null);
	const defaultId = $derived(run.defaultTemplate.state === 'ready' ? (run.defaultTemplate.value?.id ?? null) : null);
	const outline = $derived(run.template ? templateOutline(run.template) : null);
	const context = $derived([run.project?.name ?? null, run.entityType, run.template?.code ?? null].filter(Boolean).join(' · '));

	const GRID = 'grid grid-cols-[7rem_2.5rem_minmax(9rem,1fr)_minmax(12rem,2fr)_4.5rem_4.5rem] gap-x-3';
</script>

<svelte:head><title>Template · SG Task Templates</title></svelte:head>

{#snippet item(t: Template)}
	<button
		type="button"
		class={[
			'focus-visible:ring-ring flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors duration-150 focus-visible:ring-2',
			t.id === run.templateId ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted'
		].join(' ')}
		aria-pressed={t.id === run.templateId}
		onclick={() => run.setTemplate(t.id)}
		title={t.code}
	>
		<span class="min-w-0 flex-1 truncate">{t.code}</span>
		{#if t.id === defaultId}
			<span class="text-muted-foreground border-border inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-xs font-medium" data-slot="project-default">Project default</span>
		{/if}
		<span class="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums" aria-label={`${t.tasks.length} tasks`}>{t.tasks.length}</span>
	</button>
{/snippet}

{#snippet field(label: string, body: Snippet)}
	<div class="flex flex-col gap-1.5">
		<span class="text-muted-foreground text-xs font-medium">{label}</span>
		{@render body()}
	</div>
{/snippet}

{#snippet projectBody()}
	<ProjectPicker
		context={liveContext()}
		value={run.project ? { type: 'Project', id: run.project.id, name: run.project.name } : null}
		onValueChange={(value) => run.setProject(value ? { id: value.id, name: value.name ?? undefined } : null)}
		placeholder="Pick a project"
	/>
{/snippet}

{#snippet typeBody()}
	{#if !run.project}
		<p class="text-muted-foreground text-sm">Pick a project first.</p>
	{:else if run.types.state === 'ready'}
		{#if run.types.value.length === 0}
			<p class="text-muted-foreground text-sm">No entity type in this project has a task template field.</p>
		{:else}
			<EntityTypePicker
				context={liveContext()}
				allow={run.types.value}
				value={run.entityType}
				onValueChange={(value) => run.setEntityType(value)}
				placeholder="Pick an entity type"
			/>
		{/if}
	{:else if run.types.state === 'error'}
		<p class="text-destructive text-sm">Could not read the entity types: {run.types.message}</p>
	{:else}
		<div class="flex flex-col gap-1.5" data-slot="types-loading">
			<Skeleton class="h-8 w-full" />
			<span class="text-muted-foreground text-xs">Reading which types take a template, once per session…</span>
		</div>
	{/if}
{/snippet}

{#await started}
	<PageState state="loading" title="Reaching the site…" />
{:then}
	{#if run.problem}
		<PageState state="error" title="Not connected" line={run.problem}>
			{#snippet action()}<Button href="/connect">Connect</Button>{/snippet}
		</PageState>
	{:else}
		<PageHeader title="Template" context={context || 'Pick the project, the entity type, then the template to apply.'}>
			{#snippet actions()}
				<Button href={run.template ? '/entities' : undefined} disabled={!run.template} data-slot="next-entities">
					Next: entities <ArrowRight data-icon="inline-end" />
				</Button>
			{/snippet}
		</PageHeader>

		<div class="flex min-h-0 flex-1">
			<aside class="border-border flex w-80 shrink-0 flex-col border-r" aria-label="Choose the template" data-slot="template-picks">
				<div class="flex flex-col gap-4 p-4">
					{@render field('Project', projectBody)}
					{@render field('Entity type', typeBody)}
				</div>

				{#if run.project && run.entityType}
					<div class="border-border flex min-h-0 flex-1 flex-col border-t" data-slot="template-list">
						<div class="flex flex-col gap-1.5 px-4 pt-4 pb-2">
							<span class="text-muted-foreground text-xs font-medium">Template</span>
							<div class="relative">
								<Search class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" aria-hidden="true" />
								<Input class="h-8 pl-8" type="search" placeholder="Filter templates" bind:value={query} aria-label="Filter templates" />
							</div>
						</div>
						<div class="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Templates">
							{#if run.templates.state === 'error'}
								<StateLine state="error" label={`Could not read the templates: ${run.templates.message}`} pad="popover" />
							{:else if !groups}
								<div class="flex flex-col px-2" aria-label="Reading the templates">
									{#each [90, 70, 80, 60] as w, i (i)}<div class="py-1.5"><Skeleton class="h-5" style={`width:${w}%`} /></div>{/each}
								</div>
							{:else}
								<p class="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">For {run.entityType}</p>
								{#each groups.matching as t (t.id)}{@render item(t)}{:else}
									<p class="text-muted-foreground px-2 py-1.5 text-sm">{query ? 'No match.' : `No template names ${run.entityType}.`}</p>
								{/each}
								{#if groups.others.length > 0}
									<p class="text-muted-foreground px-2 pt-4 pb-1 text-xs font-medium">Other types · allowed, the plan warns</p>
									{#each groups.others as t (t.id)}{@render item(t)}{/each}
								{/if}
							{/if}
						</div>
					</div>
				{/if}
			</aside>

			<section class="flex min-w-0 flex-1 flex-col overflow-y-auto" aria-label="Template detail">
				{#if run.template && outline}
					{@const t = run.template}
					<div class="flex flex-col gap-6 px-6 py-5">
						<div class="flex flex-col gap-2">
							<h2 class="text-base font-semibold">{t.code}</h2>
							<p class="text-muted-foreground text-sm tabular-nums">
								For {t.entityType ?? 'any type'} · {outline.taskCount}
								{outline.taskCount === 1 ? 'task' : 'tasks'} in {outline.groups.length}
								{outline.groups.length === 1 ? 'step' : 'steps'} · {outline.edgeCount}
								{outline.edgeCount === 1 ? 'dependency' : 'dependencies'}
							</p>
							{#if t.entityType !== run.entityType}
								<Notice tone="warning" title={`Not a ${run.entityType} template.`}>{' '}Allowed; the plan warns on every entity.</Notice>
							{/if}
						</div>

						<Section title="Tasks by step" meta="What each task waits on, offsets in working days (wd)." data-slot="template-tasks">
							<div class="bg-card text-card-foreground overflow-hidden rounded-lg border" role="table" aria-label="Template tasks">
								<div class={`${GRID} text-muted-foreground border-border border-b px-3 py-2 text-xs font-medium`} role="row">
									<span role="columnheader">Step</span>
									<span class="text-right" role="columnheader">Order</span>
									<span role="columnheader">Task</span>
									<span role="columnheader">Waits on</span>
									<span class="text-right" role="columnheader">Duration</span>
									<span class="text-right" role="columnheader">Est. (min)</span>
								</div>
								{#each outline.groups as group (group.stepId ?? 'none')}
									<div class="border-border border-b last:border-b-0" role="rowgroup" data-slot="step-group">
										{#each group.tasks as task, i (task.id)}
											<div class={`${GRID} items-start px-3 py-1.5 text-sm`} role="row">
												<span class="min-w-0 truncate text-xs leading-5 font-medium" role={i === 0 ? 'rowheader' : 'cell'} title={group.step}>
													{#if i === 0}{group.step}{/if}
												</span>
												<span class="text-muted-foreground text-right font-mono text-xs leading-5 tabular-nums" role="cell">{task.sortOrder ?? ''}</span>
												<span class="flex min-w-0 items-center gap-1.5 font-medium" role="cell">
													<span class="truncate" title={task.name}>{task.name}</span>
													{#if task.milestone}<Flag class="text-muted-foreground size-3.5 shrink-0" aria-label="Milestone" />{/if}
												</span>
												<span class="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5" role="cell">
													{#each task.after as edge, j (edge.id ?? j)}
														<span class="whitespace-nowrap">
															<span class="text-muted-foreground">{edge.phrase}</span>
															{edge.upstream}
															{#if edge.offset}<span class="text-muted-foreground font-mono text-xs tabular-nums">{edge.offset}</span>{/if}
														</span>
													{:else}
														<span class="text-muted-foreground">{task.feeds > 0 ? 'Starts the chain' : '—'}</span>
													{/each}
												</span>
												<span class="text-right tabular-nums" role="cell">{task.duration ?? ''}</span>
												<span class="text-right tabular-nums" role="cell">{task.estInMins ?? ''}</span>
											</div>
										{/each}
									</div>
								{:else}
									<p class="text-muted-foreground px-3 py-10 text-center text-sm">This template has no tasks.</p>
								{/each}
							</div>
						</Section>
					</div>
				{:else if run.project && run.entityType}
					<PageState state="empty" icon={LayoutTemplate} title="Pick a template" line="Its tasks show here by step, with what each waits on.">
						{#snippet action()}
							{#if defaultId !== null}
								<Button variant="outline" onclick={() => run.setTemplate(defaultId)}>Pick the project default</Button>
							{/if}
						{/snippet}
					</PageState>
				{:else}
					<PageState state="empty" icon={LayoutTemplate} title="Pick a project and an entity type" line="Then the templates for that type list on the left." />
				{/if}
			</section>
		</div>
	{/if}
{/await}
