<!--
	The plan's right pane: one entity's Tasks by action, then its edges and date impact. Every choice
	calls `onOptions` with new RunOptions (plan-view.ts setters); the page re-plans through `run`.
-->
<script lang="ts">
	import type { EntityPlan, EntityTask, ExtraAction, FieldChange, FieldFill, Id, RunOptions, Template } from '$lib/pure/types';
	import { withEntityConflictPick } from '$lib/pure/planner';
	import {
		CAUSE_LABEL,
		EXTRA_ACTIONS,
		conflictResolved,
		picksFor,
		edgeView,
		entityWarnings,
		fillLabels,
		groupRows,
		keyLabel,
		previousLinkLabel,
		valueLabel,
		withEdgeAction,
		withExtraAction
	} from '$lib/pure/plan-view';
	import StatusBadge from '$lib/components/status-badge.svelte';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

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
	const taskName = (t: { id: Id; content: string | null }) => `${t.content ?? '(no name)'} #${t.id}`;
	const offset = (n: number | null) => (n === null ? 'no offset' : `offset ${n}`);
	const LEVEL: Record<string, string> = {
		block: 'border-destructive/40 bg-destructive/10 text-destructive',
		warn: 'border-warning/40 bg-warning/10 text-warning',
		info: 'border-border bg-muted text-muted-foreground'
	};
	const POLICY: Record<string, string> = { keep: 'keep', overwrite: 'overwrite', fill_if_empty: 'fill if empty' };
	const changed = (c: FieldChange) => valueLabel(c.result) !== valueLabel(c.current);
</script>

{#snippet fieldList(changes: FieldChange[] | undefined)}
	{#if changes && changes.length > 0}
		<ul class="text-muted-foreground mt-1 flex flex-col gap-0.5 text-xs" data-slot="field-changes">
			{#each changes.filter((c) => c.field !== 'content') as c (c.field)}
				<li>
					<span class="font-mono">{c.field}</span>
					{#if changed(c)}
						<span class="text-foreground">{valueLabel(c.current)} → {valueLabel(c.result)}</span>
					{:else}
						keeps {valueLabel(c.current)} <span class="opacity-70">(template {valueLabel(c.template)})</span>
					{/if}
					<span class="opacity-70">· {POLICY[c.policy]}</span>
				</li>
			{/each}
		</ul>
	{/if}
{/snippet}

{#snippet fillList(fills: FieldFill[] | undefined)}
	{#each fillLabels(fills) as line (line)}
		<p class="text-muted-foreground text-xs" data-slot="fill">{line}</p>
	{/each}
{/snippet}

{#snippet status(code: string | null)}
	{#if code}<StatusBadge {code} variant="text" size="xs" label="code" />{/if}
{/snippet}

{#snippet section(title: string, count: number, tone: string)}
	<h3 class="flex items-baseline gap-2 text-sm font-semibold">
		<span class={tone}>{title}</span><span class="text-muted-foreground font-mono text-xs tabular-nums">{count}</span>
	</h3>
{/snippet}

<div class="flex flex-col gap-5 p-4" data-slot="plan-entity-detail">
	<header class="flex flex-col gap-1">
		<h2 class="text-base font-semibold">{plan.entity.name ?? `${plan.entity.type} #${plan.entity.id}`}</h2>
		<p class="text-muted-foreground text-xs">
			{plan.entity.entityType} · now on {plan.entity.taskTemplate?.name ?? 'no template'}
			{#if plan.needsClearFirst}· already on this template: the write clears then sets it (084){/if}
			{#if plan.noop}· nothing to write{/if}
		</p>
		{#each warnings as w (w.code + w.text)}
			<p class={['rounded-md border px-2 py-1 text-xs', LEVEL[w.level]].join(' ')} data-slot="entity-warning">{w.text}</p>
		{/each}
	</header>

	{#if groups.conflict.length > 0}
		<section class="flex flex-col gap-2" data-slot="rows-conflict">
			{@render section('Conflicts', groups.conflict.length, 'text-destructive')}
			{#each groups.conflict as row (row.key)}
				{@const resolved = conflictResolved(row, options, plan.entity.id)}
				{@const picks = picksFor(options, plan.entity.id)}
				<div class={['rounded-md border p-2', resolved ? 'border-border' : 'border-destructive/50'].join(' ')}>
					<p class="text-xs">
						<span class="font-mono">{keyLabel(row.key, row.templateTasks[0]?.step ?? null)}</span>
						· pre-pick by <span class="font-medium">{row.reason}</span>
						{#if !resolved}<span class="text-destructive">· unresolved</span>{/if}
					</p>
					{#each row.templateTasks as tt (tt.id)}
						<div class="mt-2 flex flex-col gap-1">
							<span class="text-xs">Template task <span class="font-medium">{tt.content}</span> takes:</span>
							<ToggleGroup.Root
								type="single"
								size="sm"
								variant="outline"
								value={tt.id in picks ? String(row.pick[tt.id] ?? 'create') : ''}
								onValueChange={(v) => v && onOptions(withEntityConflictPick(options, plan.entity.id, tt.id, v === 'create' ? null : Number(v)))}
								aria-label={`Pick for ${tt.content}`}
								class="flex-wrap"
							>
								{#each row.candidates as c (c.task.id)}
									<ToggleGroup.Item value={String(c.task.id)} class="h-auto py-1">
										<span class="flex flex-col items-start text-left text-xs">
											<span>
												{taskName(c.task)}
												{#if row.prePick[tt.id] === c.task.id}<span class="text-info">· pre-pick</span>{/if}
												{#if row.pick[tt.id] === c.task.id && !(tt.id in picks)}<span class="text-muted-foreground">· shown</span>{/if}
											</span>
											<span class="text-muted-foreground">
												{c.task.status ?? 'no status'} · {c.usage.versions} ver · {c.usage.publishedFiles} pub · {c.task.createdAt.slice(0, 10)}
											</span>
										</span>
									</ToggleGroup.Item>
								{/each}
								<ToggleGroup.Item value="create" class="text-xs">Create new</ToggleGroup.Item>
							</ToggleGroup.Root>
						</div>
					{/each}
					{#if !resolved}
						<Button
							size="xs"
							variant="outline"
							class="mt-2"
							onclick={() => {
								let next = options;
								for (const tt of row.templateTasks) if (!(tt.id in picks)) next = withEntityConflictPick(next, plan.entity.id, tt.id, row.pick[tt.id] ?? null);
								onOptions(next);
							}}>Accept the pre-pick</Button
						>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if groups.keep.length > 0}
		<section class="flex flex-col gap-1" data-slot="rows-keep">
			{@render section('Keep', groups.keep.length, 'text-foreground')}
			{#each groups.keep as row (row.task.id)}
				<div class="border-border border-b py-1 text-sm last:border-0">
					<div class="flex flex-wrap items-center gap-2">
						<span>{taskName(row.task)}</span>
						{@render status(row.task.status)}
						<span class="text-muted-foreground font-mono text-xs">{keyLabel(row.task.key, row.task.step)}</span>
						{#if row.keyMismatch}<span class="text-warning text-xs">linked, name or step changed</span>{/if}
					</div>
					{#if row.rename}
						<p class={['text-xs', row.rename.handRenamed ? 'text-destructive font-semibold' : 'text-warning'].join(' ')} data-slot="rename">
							{row.rename.handRenamed ? 'Renamed by hand, will be renamed back:' : 'Rename:'}
							{row.rename.from ?? '(empty)'} → {row.rename.to ?? '(empty)'}
						</p>
					{/if}
					{@render fieldList(row.fieldChanges)}
					{@render fillList(row.fills)}
				</div>
			{/each}
		</section>
	{/if}

	{#if groups.claim.length > 0}
		<section class="flex flex-col gap-1" data-slot="rows-claim">
			{@render section('Claim', groups.claim.length, 'text-info')}
			{#each groups.claim as row (row.task.id)}
				<div class="border-border border-b py-1 text-sm last:border-0">
					<div class="flex flex-wrap items-center gap-2">
						<span>{taskName(row.task)}</span>
						{@render status(row.task.status)}
						<span class="text-muted-foreground font-mono text-xs">{keyLabel(row.task.key, row.task.step)}</span>
						<span class="text-muted-foreground text-xs">→ {row.templateTask.content}</span>
					</div>
					<p class="text-muted-foreground text-xs">was: {previousLinkLabel(row.previousTemplateTask, templates)}</p>
					{#if row.rename}
						<p class="text-warning text-xs" data-slot="rename">Rename: {row.rename.from ?? '(empty)'} → {row.rename.to ?? '(empty)'}</p>
					{/if}
					{@render fieldList(row.fieldChanges)}
					{@render fillList(row.fills)}
				</div>
			{/each}
		</section>
	{/if}

	{#if groups.create.length > 0}
		<section class="flex flex-col gap-1" data-slot="rows-create">
			{@render section('Create', groups.create.length, 'text-success')}
			{#each groups.create as row (row.templateTask.id)}
				{@const dated = row.templateDates.start !== null || row.templateDates.due !== null}
				<div class="border-border flex flex-wrap items-center gap-2 border-b py-1 text-sm last:border-0">
					<span>{row.templateTask.content}</span>
					<span class="text-muted-foreground font-mono text-xs">{keyLabel(row.templateTask.key, row.templateTask.step)}</span>
					{#if dated}
						<span class="text-muted-foreground text-xs">
							dates {row.templateDates.start ?? '–'} → {row.templateDates.due ?? '–'}
							{#if row.datesClearable && options.clearCreatedDates}<span class="text-foreground">· cleared</span>
							{:else if !row.datesClearable}· has upstream: not clearable (093){/if}
						</span>
					{/if}
				</div>
			{/each}
		</section>
	{/if}

	{#if groups.extra.length > 0}
		<section class="flex flex-col gap-1" data-slot="rows-extra">
			{@render section('Extra', groups.extra.length, 'text-warning')}
			{#each groups.extra as row (row.task.id)}
				{@const used = row.usage.versions + row.usage.publishedFiles > 0}
				<div class="border-border flex flex-col gap-1 border-b py-1 text-sm last:border-0">
					<div class="flex flex-wrap items-center gap-2">
						<span>{taskName(row.task)}</span>
						{@render status(row.task.status)}
						<span class="text-muted-foreground text-xs">
							{row.reason === 'not_in_template' ? 'not in the template' : row.reason === 'link_wins' ? 'same key, another Task is linked' : 'conflict loser: unlinked (106)'}
						</span>
						<span class="mr-auto"></span>
						<ToggleGroup.Root
							type="single"
							size="sm"
							variant="outline"
							value={row.action}
							onValueChange={(v) => v && onOptions(withExtraAction(options, row.task.id, v as ExtraAction))}
							aria-label={`Action for ${row.task.content}`}
						>
							{#each EXTRA_ACTIONS as action (action)}
								<ToggleGroup.Item value={action} class="text-xs">{action}</ToggleGroup.Item>
							{/each}
						</ToggleGroup.Root>
					</div>
					{#if row.action === 'omit'}
						<p class="text-muted-foreground text-xs">Status → {options.omitStatus || 'pick one on top'}</p>
					{/if}
					{#if row.action === 'delete'}
						<p class={['text-xs', used ? 'text-destructive font-semibold' : 'text-muted-foreground'].join(' ')} data-slot="delete-warning">
							Delete {options.deleteConfirmed ? '(confirmed)' : '(awaits confirmation)'}: {row.usage.versions} Versions, {row.usage.publishedFiles} PublishedFiles
							{used ? 'lose their Task link (089); undo revives it.' : 'linked.'}
						</p>
					{/if}
					{@render fieldList(row.fieldChanges)}
					{@render fillList(row.fills)}
				</div>
			{/each}
		</section>
	{/if}

	<section class="flex flex-col gap-2" data-slot="edges">
		<h3 class="text-sm font-semibold">Dependencies</h3>
		{#if edges.added.length === 0 && edges.affected.length === 0 && edges.outsideDownstream.length === 0}
			<p class="text-muted-foreground text-xs">No dependency changes.</p>
		{/if}
		{#if edges.added.length > 0}
			<div>
				<p class="text-xs font-medium">Added by the apply ({edges.added.length})</p>
				<ul class="text-xs">
					{#each edges.added as e, i (i)}
						<li>
							{e.upstream.label}{#if e.upstream.created}&nbsp;<span class="text-success">(new)</span>{/if} →
							{e.downstream.label}{#if e.downstream.created}&nbsp;<span class="text-success">(new)</span>{/if}
							<span class="text-muted-foreground">· {e.type}, {offset(e.offsetDays)}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if edges.affected.length > 0}
			<div class="flex flex-col gap-1">
				<p class="text-xs font-medium">Deleted or replaced by the apply ({edges.affected.length}): keep re-creates it after, as a new edge</p>
				{#each edges.affected as e (e.id)}
					<div class="border-border flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-xs" data-slot="affected-edge">
						<span>
							{e.upstream.label} → {e.downstream.label}
							<span class="text-muted-foreground">· {e.type}, {offset(e.offsetDays)} · {CAUSE_LABEL[e.cause]}</span>
							{#if e.replacedBy}
								<span class="text-muted-foreground">
									· template: {e.replacedBy.type}, {offset(e.replacedBy.offsetDays)}{e.replacedBy.reversed ? ', reversed' : ''}
								</span>
							{/if}
						</span>
						<span class="mr-auto"></span>
						<ToggleGroup.Root
							type="single"
							size="sm"
							variant="outline"
							value={e.action}
							onValueChange={(v) => v && onOptions(withEdgeAction(options, e.id, v as 'keep' | 'remove'))}
							aria-label={`Edge ${e.id}`}
						>
							<ToggleGroup.Item value="keep" class="text-xs" disabled={e.keepDisabled !== null} title={e.keepDisabled ?? undefined}>keep</ToggleGroup.Item>
							<ToggleGroup.Item value="remove" class="text-xs">remove</ToggleGroup.Item>
						</ToggleGroup.Root>
						{#if e.keepDisabled}<p class="text-warning w-full">{e.keepDisabled}</p>{/if}
					</div>
				{/each}
			</div>
		{/if}
		{#if edges.outsideDownstream.length > 0}
			<div>
				<p class="text-xs font-medium">To Tasks outside the template, kept by the apply ({edges.outsideDownstream.length})</p>
				<ul class="text-muted-foreground text-xs">
					{#each edges.outsideDownstream as e, i (i)}
						<li>{e.upstream.label} → {e.downstream.label} · {e.type}, {offset(e.offsetDays)}</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if edges.mayMove.length > 0 || edges.wouldViolate.length > 0}
			<div class="text-xs" data-slot="date-impact">
				{#if edges.mayMove.length > 0}
					<p><span class="font-medium">Dates may move</span> (unpinned, downstream of a new edge, 092): {edges.mayMove.join(', ')}</p>
				{/if}
				{#if edges.wouldViolate.length > 0}
					<p class="text-warning">
						<span class="font-medium">Would flag dependency_violation</span> (pinned, holds its dates, 092): {edges.wouldViolate.join(', ')}
					</p>
				{/if}
			</div>
		{/if}
	</section>
</div>
