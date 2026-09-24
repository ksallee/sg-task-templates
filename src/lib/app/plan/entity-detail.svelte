<!--
	The plan's detail pane: one entity's Tasks, one line each with its outcome and markers, grouped by
	outcome with "needs a choice" first (plan-summary.ts). Everything else folds under its Task: why,
	field values, the old link, its dependencies, the extra's action, the conflict picker. The edges
	as a whole fold under "Dependencies". Every choice calls `onOptions` with new RunOptions
	(plan-view.ts setters); the page re-plans through `run`.
-->
<script lang="ts">
	import type { ConflictRow, EntityPlan, EntityTask, ExtraAction, Id, RunOptions, Template } from '$lib/pure/types';
	import { withEntityConflictPick } from '$lib/pure/planner';
	import {
		CAUSE_LABEL,
		EXTRA_ACTIONS,
		PICK_REASON,
		conflictResolved,
		picksFor,
		edgeView,
		entityWarnings,
		withEdgeAction,
		withExtraAction,
		type EdgeEnd
	} from '$lib/pure/plan-view';
	import type { EntitySummary, TaskLine } from '$lib/pure/plan-summary';
	import Notice from '$lib/app/notice.svelte';
	import Segmented from '$lib/app/segmented.svelte';
	import OutcomeChip from './outcome-chip.svelte';
	import { TONE_TEXT } from './tone';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { cn } from '$lib/utils.js';

	type Props = {
		plan: EntityPlan;
		summary: EntitySummary;
		template: Template;
		tasks: EntityTask[];
		options: RunOptions;
		onOptions: (next: RunOptions) => void;
	};
	let { plan, summary, template, tasks, options, onOptions }: Props = $props();

	const edges = $derived(edgeView(plan, template, tasks));
	const warnings = $derived(entityWarnings(plan, options).filter((w) => w.code !== 'unresolved_conflict_row'));
	const picks = $derived(picksFor(options, plan.entity.id));
	const EXTRA_OPTIONS = EXTRA_ACTIONS.map((a) => ({ value: a, label: a, tone: a === 'delete' ? ('destructive' as const) : undefined }));
	const TONE = { block: 'destructive', warn: 'warning', info: 'info' } as const;
	const noEdges = $derived(edges.added.length === 0 && edges.affected.length === 0 && edges.outsideDownstream.length === 0);
	const edgeLine = $derived(
		[
			edges.added.length ? `${edges.added.length} added` : null,
			edges.affected.length
				? `${edges.affected.length} dropped by the apply (${edges.affected.filter((e) => e.action === 'keep').length} re-created)`
				: null,
			edges.outsideDownstream.length ? `${edges.outsideDownstream.length} to Tasks outside the template, kept` : null,
			edges.mayMove.length ? `dates may move on ${edges.mayMove.length}` : null,
			edges.wouldViolate.length ? `${edges.wouldViolate.length} would flag a violation` : null
		]
			.filter(Boolean)
			.join(' · ') || 'No dependency changes'
	);

	/** Open folds, by entity and line; a line that needs a choice starts open. */
	let open = $state<Record<string, boolean>>({});
	let depsOpen = $state(false);
	const foldKey = (l: TaskLine) => `${plan.entity.id}:${l.id}`;
	const isOpen = (l: TaskLine) => open[foldKey(l)] ?? l.outcome === 'needs_choice';
	const allLines = $derived(summary.groups.flatMap((g) => g.lines));
	const anyClosed = $derived(allLines.some((l) => !isOpen(l)));
	function setAll(on: boolean): void {
		const next = { ...open };
		for (const l of allLines) next[foldKey(l)] = on;
		open = next;
		depsOpen = on;
	}
</script>

{#snippet end(e: EdgeEnd)}
	<span class="font-medium">{e.label}</span>{#if e.created}<span
			class="border-success/60 text-success ml-1 inline-flex h-5 items-center rounded-md border px-1.5 align-middle text-xs font-medium">new</span
		>{/if}
{/snippet}

{#snippet waits(e: { upstream: EdgeEnd; downstream: EdgeEnd; phrase: string; offset: string | null })}
	<span>
		{@render end(e.downstream)}
		<span class="text-muted-foreground">{e.phrase}</span>
		{@render end(e.upstream)}
		{#if e.offset}<span class="text-muted-foreground font-mono text-xs">{e.offset}</span>{/if}
	</span>
{/snippet}

{#snippet picker(row: ConflictRow)}
	{@const resolved = conflictResolved(row, options, plan.entity.id)}
	<div class="flex flex-col gap-3" data-slot="conflict-picker">
		{#if !resolved}
			<div>
				<Button
					size="xs"
					variant="outline"
					onclick={() => {
						let next = options;
						for (const tt of row.templateTasks) if (!(tt.id in picks)) next = withEntityConflictPick(next, plan.entity.id, tt.id, row.pick[tt.id] ?? null);
						onOptions(next);
					}}>Accept the pre-pick</Button
				>
			</div>
		{/if}
		{#each row.templateTasks as tt (tt.id)}
			{@const chosen = tt.id in picks ? String(row.pick[tt.id] ?? 'create') : ''}
			<fieldset class="flex flex-col gap-1.5">
				<legend class="mb-1.5 text-xs">Template task <span class="font-medium">{tt.content}</span> takes</legend>
				<div class="flex flex-col gap-1" role="radiogroup" aria-label={`Pick for ${tt.content}`}>
					{#each row.candidates as c (c.task.id)}
						{@const on = chosen === String(c.task.id)}
						{@const pre = row.prePick[tt.id] === c.task.id}
						<button
							type="button"
							role="radio"
							aria-checked={on}
							class={cn(
								'flex items-start gap-3 rounded-md border px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
								on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
							)}
							onclick={() => onOptions(withEntityConflictPick(options, plan.entity.id, tt.id, c.task.id))}
							data-slot="conflict-candidate"
						>
							<span
								class={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', on ? 'border-primary' : 'border-input')}
								aria-hidden="true">{#if on}<span class="bg-primary size-2 rounded-full"></span>{/if}</span
							>
							<span class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="flex flex-wrap items-center gap-2">
									<span class="font-medium">{c.task.content ?? '(no name)'}</span>
									<span class="text-muted-foreground text-xs tabular-nums">#{c.task.id}</span>
									{#if c.task.status}<StatusBadge code={c.task.status} variant="text" size="xs" label="code" />{/if}
									{#if pre}
										<span class="border-info/60 text-info inline-flex h-5 items-center rounded-md border px-1.5 text-xs font-medium">pre-pick</span>
										<span class="text-muted-foreground text-xs">{PICK_REASON[row.reason]}</span>
									{/if}
								</span>
								<span class="text-muted-foreground text-xs tabular-nums">
									{c.usage.versions} Versions · {c.usage.publishedFiles} PublishedFiles · created {c.task.createdAt.slice(0, 10)}
								</span>
							</span>
						</button>
					{/each}
					<button
						type="button"
						role="radio"
						aria-checked={chosen === 'create'}
						class={cn(
							'flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
							chosen === 'create' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
						)}
						onclick={() => onOptions(withEntityConflictPick(options, plan.entity.id, tt.id, null))}
					>
						<span
							class={cn('flex size-4 shrink-0 items-center justify-center rounded-full border', chosen === 'create' ? 'border-primary' : 'border-input')}
							aria-hidden="true">{#if chosen === 'create'}<span class="bg-primary size-2 rounded-full"></span>{/if}</span
						>
						<span>Create a new Task <span class="text-muted-foreground text-xs">· the candidates become Not in template</span></span>
					</button>
				</div>
			</fieldset>
		{/each}
	</div>
{/snippet}

<div class="flex flex-col gap-6 px-6 py-4" data-slot="plan-entity-detail">
	<header class="flex flex-col gap-1.5">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<h2 class="text-base font-semibold">{plan.entity.name ?? `${plan.entity.type} #${plan.entity.id}`}</h2>
			<span class="text-sm" data-slot="entity-line">{summary.line}</span>
			<span class="mr-auto"></span>
			<Button size="xs" variant="ghost" onclick={() => setAll(anyClosed)} data-slot="expand-all">{anyClosed ? 'Expand all' : 'Collapse all'}</Button>
		</div>
		<p class="text-muted-foreground text-xs">
			{plan.entity.entityType} · now on {plan.entity.taskTemplate?.name ?? 'no template'}
			{#if plan.needsClearFirst}· already on this template: the write clears then sets it (084){/if}
		</p>
		{#each warnings as w (w.code + w.text)}
			<Notice tone={TONE[w.level]} data-slot="entity-warning">{w.text}</Notice>
		{/each}
	</header>

	{#each summary.groups as g (g.outcome)}
		<section class="flex flex-col gap-2" data-slot="task-group" data-outcome={g.outcome}>
			<div class="flex flex-wrap items-center gap-2">
				<OutcomeChip outcome={g.outcome} count={g.lines.length} entityType={plan.entity.type} />
				<span class="text-muted-foreground text-xs">{g.meaning}</span>
			</div>
			<ul class={cn('divide-border flex flex-col divide-y rounded-lg border', g.outcome === 'needs_choice' && 'border-destructive/60')}>
				{#each g.lines as l (l.id)}
					{@const on = isOpen(l)}
					<li data-slot="task-line" data-outcome={l.outcome}>
						<button
							type="button"
							class="hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
							aria-expanded={on}
							onclick={() => (open = { ...open, [foldKey(l)]: !on })}
						>
							<ChevronRight class={cn('text-muted-foreground size-4 shrink-0 transition-transform', on && 'rotate-90')} aria-hidden="true" />
							<span class="truncate font-medium">{l.name}</span>
							{#if l.taskId !== null}<span class="text-muted-foreground text-xs tabular-nums">#{l.taskId}</span>{/if}
							{#if l.status && l.taskId !== null}<StatusBadge code={l.status} variant="text" size="xs" label="code" />{/if}
							<span class="mr-auto"></span>
							{#each l.markers as m (m.key)}
								<span class={cn('inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-xs whitespace-nowrap', TONE_TEXT[m.tone])} data-slot="task-marker"
									>{m.label}</span
								>
							{/each}
							<OutcomeChip outcome={l.outcome} entityType={plan.entity.type} />
						</button>
						{#if on}
							<div class="flex flex-col gap-2 pr-3 pb-3 pl-9" data-slot="task-fold">
								<ul class="flex flex-col gap-0.5 text-xs">
									{#each l.details as d, i (i)}
										<li
											class={cn(
												d.tone === 'destructive' ? 'text-destructive font-medium' : d.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'
											)}
										>
											{d.text}
										</li>
									{/each}
								</ul>
								{#if l.row.kind === 'extra'}
									{@const row = l.row}
									<div class="flex items-center gap-2">
										<span class="text-muted-foreground text-xs">This Task:</span>
										<Segmented
											label={`Action for ${row.task.content}`}
											value={row.action}
											options={EXTRA_OPTIONS}
											onChange={(v) => onOptions(withExtraAction(options, row.task.id, v as ExtraAction))}
										/>
									</div>
								{/if}
								{#if l.conflict}{@render picker(l.conflict)}{/if}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<section class="flex flex-col gap-3" data-slot="edges">
		<button
			type="button"
			class="hover:bg-muted -mx-2 flex items-baseline gap-2 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-expanded={depsOpen}
			onclick={() => (depsOpen = !depsOpen)}
			data-slot="deps-toggle"
		>
			<ChevronRight class={cn('text-muted-foreground size-4 shrink-0 self-center transition-transform', depsOpen && 'rotate-90')} aria-hidden="true" />
			<h3 class="text-sm font-semibold">Dependencies</h3>
			<span class="text-muted-foreground text-xs">{edgeLine}</span>
		</button>
		{#if depsOpen}
			<p class="text-muted-foreground text-xs">What each Task waits on, offsets in working days (wd).</p>
			{#if noEdges}
				<p class="text-muted-foreground text-sm">No dependency changes.</p>
			{/if}
			{#if edges.added.length > 0}
				<div class="flex flex-col gap-1.5">
					<p class="text-muted-foreground text-xs font-medium">Added by the apply · {edges.added.length}</p>
					<ul class="divide-border flex flex-col divide-y rounded-lg border text-sm">
						{#each edges.added as e, i (i)}
							<li class="px-3 py-1.5">{@render waits(e)}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if edges.affected.length > 0}
				<div class="flex flex-col gap-1.5">
					<p class="text-muted-foreground text-xs font-medium">
						Deleted or replaced by the apply · {edges.affected.length} <span class="font-normal">· keep re-creates it after, as a new edge</span>
					</p>
					<ul class="divide-border flex flex-col divide-y rounded-lg border text-sm">
						{#each edges.affected as e (e.id)}
							<li class="flex flex-col gap-1 px-3 py-2" data-slot="affected-edge">
								<div class="flex flex-wrap items-center gap-2">
									{@render waits(e)}
									<span class="mr-auto"></span>
									<Segmented
										label={`Edge ${e.id}`}
										value={e.action}
										options={[
											{ value: 'keep', label: 'keep', disabled: e.keepDisabled !== null, title: e.keepDisabled ?? undefined },
											{ value: 'remove', label: 'remove', tone: 'destructive' }
										]}
										onChange={(v) => onOptions(withEdgeAction(options, e.id, v as 'keep' | 'remove'))}
									/>
								</div>
								<p class="text-muted-foreground text-xs">
									{CAUSE_LABEL[e.cause]}{#if e.replacedBy}; the template's: {e.replacedBy.reversed ? 'reversed, ' : ''}{e.replacedBy.phrase}{e.replacedBy.offset
											? ` ${e.replacedBy.offset}`
											: ''}{/if}
								</p>
								{#if e.keepDisabled}<p class="text-warning text-xs">{e.keepDisabled}</p>{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if edges.outsideDownstream.length > 0}
				<div class="flex flex-col gap-1.5">
					<p class="text-muted-foreground text-xs font-medium">To Tasks outside the template, kept by the apply · {edges.outsideDownstream.length}</p>
					<ul class="divide-border text-muted-foreground flex flex-col divide-y rounded-lg border text-sm">
						{#each edges.outsideDownstream as e, i (i)}
							<li class="px-3 py-1.5">{@render waits(e)}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if edges.mayMove.length > 0}
				<Notice tone="info" title="Dates may move: " data-slot="date-impact">
					{edges.mayMove.join(', ')}. Unpinned, downstream of a new edge (092).
				</Notice>
			{/if}
			{#if edges.wouldViolate.length > 0}
				<Notice tone="warning" title="Would flag dependency_violation: " data-slot="date-violation">
					{edges.wouldViolate.join(', ')}. Pinned, they hold their dates (092).
				</Notice>
			{/if}
		{/if}
	</section>
</div>
