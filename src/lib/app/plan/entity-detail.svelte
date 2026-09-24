<!--
	The plan's detail pane: one entity's Tasks by kind (conflicts first, they block), then its edges
	in the template outline's words and the date impact. Every choice calls `onOptions` with new
	RunOptions (plan-view.ts setters); the page re-plans through `run`.
-->
<script lang="ts">
	import type { EntityPlan, EntityTask, ExtraAction, FieldChange, FieldFill, Id, MatchKey, PlanKind, RunOptions, Template } from '$lib/pure/types';
	import { withEntityConflictPick } from '$lib/pure/planner';
	import {
		CAUSE_LABEL,
		EXTRA_ACTIONS,
		EXTRA_REASON,
		PICK_REASON,
		conflictResolved,
		picksFor,
		edgeView,
		entityWarnings,
		fillLabels,
		groupRows,
		keyLabel,
		policyLabel,
		previousLinkLabel,
		valueLabel,
		withEdgeAction,
		withExtraAction,
		type EdgeEnd
	} from '$lib/pure/plan-view';
	import CountChip, { KIND_MEANING } from '$lib/app/count-chip.svelte';
	import CountChips from '$lib/app/count-chips.svelte';
	import Notice from '$lib/app/notice.svelte';
	import Segmented from '$lib/app/segmented.svelte';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PencilLine from '@lucide/svelte/icons/pencil-line';
	import { cn } from '$lib/utils.js';

	type Props = {
		plan: EntityPlan;
		template: Template;
		templates: Template[];
		tasks: EntityTask[];
		options: RunOptions;
		onOptions: (next: RunOptions) => void;
	};
	let { plan, template, templates, tasks, options, onOptions }: Props = $props();

	const groups = $derived(groupRows(plan.rows));
	const edges = $derived(edgeView(plan, template, tasks));
	const warnings = $derived(entityWarnings(plan, options));
	const picks = $derived(picksFor(options, plan.entity.id));
	const changed = (c: FieldChange) => valueLabel(c.result) !== valueLabel(c.current);
	const EXTRA_OPTIONS = EXTRA_ACTIONS.map((a) => ({ value: a, label: a, tone: a === 'delete' ? ('destructive' as const) : undefined }));
	const TONE = { block: 'destructive', warn: 'warning', info: 'info' } as const;
	const noEdges = $derived(edges.added.length === 0 && edges.affected.length === 0 && edges.outsideDownstream.length === 0);
</script>

{#snippet name(t: { id: Id; content: string | null })}
	<span class="font-medium">{t.content ?? '(no name)'}</span>
	<span class="text-muted-foreground text-xs tabular-nums">#{t.id}</span>
{/snippet}

{#snippet status(code: string | null)}
	{#if code}<StatusBadge {code} variant="text" size="xs" label="code" />{/if}
{/snippet}

{#snippet key(k: MatchKey, step: { name?: string } | null)}
	<span class="text-muted-foreground font-mono text-xs">{keyLabel(k, step)}</span>
{/snippet}

{#snippet kindHeader(kind: PlanKind, count: number)}
	<div class="flex flex-wrap items-center gap-2">
		<CountChip {kind} {count} />
		<span class="text-muted-foreground text-xs">{KIND_MEANING[kind]}</span>
	</div>
{/snippet}

{#snippet fieldList(changes: FieldChange[] | undefined)}
	{@const shown = (changes ?? []).filter((c) => c.field !== 'content')}
	{#if shown.length > 0}
		<div class="grid grid-cols-[max-content_max-content_1fr] items-baseline gap-x-3 gap-y-0.5 pl-1 text-xs" data-slot="field-changes">
			{#each shown as c (c.field)}
				<span class="text-muted-foreground font-mono">{c.field}</span>
				<span class="text-muted-foreground border-border inline-flex h-5 items-center justify-self-start rounded-md border px-1.5">{policyLabel(c.field, c.policy)}</span>
				{#if changed(c)}
					<span class="min-w-0">
						<span class="text-muted-foreground">{valueLabel(c.current)}</span>
						<ArrowRight class="text-muted-foreground inline size-3" aria-label="becomes" />
						<span class="text-foreground font-medium">{valueLabel(c.result)}</span>
					</span>
				{:else}
					<span class="text-muted-foreground min-w-0">
						keeps {valueLabel(c.current)} <span class="opacity-70">· template {valueLabel(c.template)}</span>
					</span>
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet fillList(fills: FieldFill[] | undefined)}
	{#each fillLabels(fills) as line (line)}
		<p class="text-muted-foreground pl-1 text-xs" data-slot="fill">{line}</p>
	{/each}
{/snippet}

{#snippet rename(r: { from: string | null; to: string | null; handRenamed: boolean } | null | undefined)}
	{#if r}
		<p
			class={cn(
				'flex w-fit flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
				r.handRenamed ? 'border-destructive/50 bg-destructive/10' : 'border-warning/60 bg-warning/10'
			)}
			data-slot="rename"
		>
			<PencilLine class={cn('size-3.5', r.handRenamed ? 'text-destructive' : 'text-warning')} aria-hidden="true" />
			<span class="font-medium">{r.handRenamed ? 'Renamed by hand, will be renamed back:' : 'Renamed:'}</span>
			<span class="text-muted-foreground line-through">{r.from ?? '(empty)'}</span>
			<ArrowRight class="text-muted-foreground size-3" aria-label="becomes" />
			<span class="font-medium">{r.to ?? '(empty)'}</span>
		</p>
	{/if}
{/snippet}

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

<div class="flex flex-col gap-6 px-6 py-4" data-slot="plan-entity-detail">
	<header class="flex flex-col gap-2">
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<h2 class="text-base font-semibold">{plan.entity.name ?? `${plan.entity.type} #${plan.entity.id}`}</h2>
			<CountChips counts={plan.counts} size="xs" />
		</div>
		<p class="text-muted-foreground text-xs">
			{plan.entity.entityType} · now on {plan.entity.taskTemplate?.name ?? 'no template'}
			{#if plan.needsClearFirst}· already on this template: the write clears then sets it (084){/if}
			{#if plan.noop}· nothing to write{/if}
		</p>
		{#each warnings as w (w.code + w.text)}
			<Notice tone={TONE[w.level]} data-slot="entity-warning">{w.text}</Notice>
		{/each}
	</header>

	{#if groups.conflict.length > 0}
		<section class="flex flex-col gap-3" data-slot="rows-conflict">
			{@render kindHeader('conflict', groups.conflict.length)}
			{#each groups.conflict as row (row.key)}
				{@const resolved = conflictResolved(row, options, plan.entity.id)}
				<div class={cn('bg-card flex flex-col gap-3 rounded-lg border p-4', resolved ? 'border-border' : 'border-destructive/60')}>
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<span class="font-mono text-xs">{keyLabel(row.key, row.templateTasks[0]?.step ?? null)}</span>
						<span class="text-muted-foreground text-xs">· {row.candidates.length} Tasks for {row.templateTasks.length} template task{row.templateTasks.length === 1 ? '' : 's'}</span>
						<span class="mr-auto"></span>
						{#if resolved}
							<span class="text-muted-foreground text-xs">resolved</span>
						{:else}
							<span class="text-destructive text-xs font-medium">unresolved</span>
							<Button
								size="xs"
								variant="outline"
								onclick={() => {
									let next = options;
									for (const tt of row.templateTasks) if (!(tt.id in picks)) next = withEntityConflictPick(next, plan.entity.id, tt.id, row.pick[tt.id] ?? null);
									onOptions(next);
								}}>Accept the pre-pick</Button
							>
						{/if}
					</div>
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
												{@render name(c.task)}
												{@render status(c.task.status)}
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
									<span>Create a new Task <span class="text-muted-foreground text-xs">· the candidates become extras</span></span>
								</button>
							</div>
						</fieldset>
					{/each}
				</div>
			{/each}
		</section>
	{/if}

	{#if groups.claim.length > 0}
		<section class="flex flex-col gap-3" data-slot="rows-claim">
			{@render kindHeader('claim', groups.claim.length)}
			<div class="divide-border flex flex-col divide-y rounded-lg border">
				{#each groups.claim as row (row.task.id)}
					<div class="flex flex-col gap-1.5 px-3 py-2 text-sm">
						<div class="flex flex-wrap items-center gap-2">
							{@render name(row.task)}
							{@render status(row.task.status)}
							{@render key(row.task.key, row.task.step)}
						</div>
						<p class="flex flex-wrap items-center gap-1.5 text-xs" data-slot="claim-link">
							<span class="text-muted-foreground">{previousLinkLabel(row.previousTemplateTask, templates)}</span>
							<ArrowRight class="text-info size-3.5" aria-label="now linked to" />
							<span class="font-medium">{row.templateTask.content}</span>
							<span class="text-muted-foreground">in {template.code}</span>
						</p>
						{@render rename(row.rename)}
						{@render fieldList(row.fieldChanges)}
						{@render fillList(row.fills)}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if groups.keep.length > 0}
		<section class="flex flex-col gap-3" data-slot="rows-keep">
			{@render kindHeader('keep', groups.keep.length)}
			<div class="divide-border flex flex-col divide-y rounded-lg border">
				{#each groups.keep as row (row.task.id)}
					<div class="flex flex-col gap-1.5 px-3 py-2 text-sm">
						<div class="flex flex-wrap items-center gap-2">
							{@render name(row.task)}
							{@render status(row.task.status)}
							{@render key(row.task.key, row.task.step)}
							{#if row.keyMismatch}<span class="text-warning text-xs">linked; its name or step changed</span>{/if}
						</div>
						{@render rename(row.rename)}
						{@render fieldList(row.fieldChanges)}
						{@render fillList(row.fills)}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if groups.create.length > 0}
		<section class="flex flex-col gap-3" data-slot="rows-create">
			{@render kindHeader('create', groups.create.length)}
			<div class="divide-border flex flex-col divide-y rounded-lg border">
				{#each groups.create as row (row.templateTask.id)}
					{@const dated = row.templateDates.start !== null || row.templateDates.due !== null}
					<div class="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
						<span class="font-medium">{row.templateTask.content}</span>
						{@render key(row.templateTask.key, row.templateTask.step)}
						{#if dated}
							<span class="text-muted-foreground ml-auto text-xs tabular-nums">
								{row.templateDates.start ?? '–'} → {row.templateDates.due ?? '–'}
								{#if row.datesClearable && options.clearCreatedDates}<span class="text-foreground">· cleared</span>
								{:else if !row.datesClearable}· has upstream: not clearable (093){/if}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if groups.extra.length > 0}
		<section class="flex flex-col gap-3" data-slot="rows-extra">
			{@render kindHeader('extra', groups.extra.length)}
			<div class="divide-border flex flex-col divide-y rounded-lg border">
				{#each groups.extra as row (row.task.id)}
					{@const used = row.usage.versions + row.usage.publishedFiles > 0}
					<div class="flex flex-col gap-1.5 px-3 py-2 text-sm">
						<div class="flex flex-wrap items-center gap-2">
							{@render name(row.task)}
							{@render status(row.task.status)}
							<span class="text-muted-foreground text-xs">{EXTRA_REASON[row.reason]}</span>
							<span class="mr-auto"></span>
							<Segmented
								label={`Action for ${row.task.content}`}
								value={row.action}
								options={EXTRA_OPTIONS}
								onChange={(v) => onOptions(withExtraAction(options, row.task.id, v as ExtraAction))}
							/>
						</div>
						{#if row.action === 'omit'}
							<p class="text-muted-foreground text-xs">Status → <span class="font-mono">{options.omitStatus || 'pick one in Run options'}</span></p>
						{/if}
						{#if row.action === 'delete'}
							<p class={cn('text-xs', used ? 'text-destructive font-medium' : 'text-muted-foreground')} data-slot="delete-warning">
								Delete {options.deleteConfirmed ? '(confirmed)' : '(awaits confirmation)'}: {row.usage.versions} Versions, {row.usage.publishedFiles} PublishedFiles
								{used ? 'lose their Task link (089); undo revives it.' : 'linked.'}
							</p>
						{/if}
						{@render fieldList(row.fieldChanges)}
						{@render fillList(row.fills)}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="flex flex-col gap-3" data-slot="edges">
		<div class="flex items-baseline gap-2">
			<h3 class="text-sm font-semibold">Dependencies</h3>
			<span class="text-muted-foreground text-xs">What each Task waits on, offsets in working days (wd).</span>
		</div>
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
								{CAUSE_LABEL[e.cause]}{#if e.replacedBy}; the template's: {e.replacedBy.reversed ? 'reversed, ' : ''}{e.replacedBy.phrase}{e.replacedBy.offset ? ` ${e.replacedBy.offset}` : ''}{/if}
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
	</section>
</div>
