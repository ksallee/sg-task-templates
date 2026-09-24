<!--
	The run options, for every entity at once: a policy per field the apply rewrites (102; yours by
	default, the name takes the template's), said in plain words with display names, one action per extra name, the omit status when the project has no `omt`,
	the clear-dates opt-in where a created Task may take it (097). Collapsed, one line sums them up;
	the omit status stays in that line when the project needs one picked. Every change goes out as new
	RunOptions.
-->
<script lang="ts">
	import type { EntityPlan, ExtraAction, FieldPolicy, ProjectContext, RunOptions, Template } from '$lib/pure/types';
	import { extraNames, withFieldPolicy } from '$lib/pure/planner';
	import {
		EXTRA_ACTIONS,
		clearableCreates,
		extrasSummary,
		omitChoice,
		policyFieldViews,
		withClearCreatedDates,
		withExtraNameAction,
		withOmitStatus
	} from '$lib/pure/plan-view';
	import { fieldLabel, policyChoice, policyWords } from '$lib/pure/plan-summary';
	import Segmented from '$lib/app/segmented.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	type Props = {
		template: Template;
		plans: EntityPlan[];
		ctx: ProjectContext;
		options: RunOptions;
		onOptions: (next: RunOptions) => void;
		open: boolean;
		onToggle: () => void;
		/** A line under the options: the access check. */
		footer?: Snippet;
		/** Task field display names by code name. */
		labels?: Record<string, string>;
	};
	let { template, plans, ctx, options, onOptions, open, onToggle, footer, labels }: Props = $props();

	const fields = $derived(policyFieldViews(template, options));
	const names = $derived(extraNames(plans));
	const omit = $derived(omitChoice(ctx, options));
	const clearable = $derived(clearableCreates(plans));
	const summary = $derived(
		[
			fields.length ? `Fields: ${policyWords(fields, labels)}` : 'No field to rewrite',
			names.length > 0 ? extrasSummary(names, options) : null,
			omit.ask ? null : `omit sets ${options.omitStatus}`,
			clearable > 0 && options.clearCreatedDates ? `template dates cleared on ${clearable}` : null
		]
			.filter(Boolean)
			.join(' · ')
	);
	const EXTRA_OPTIONS = EXTRA_ACTIONS.map((a) => ({ value: a, label: a, tone: a === 'delete' ? ('destructive' as const) : undefined }));
</script>

{#snippet omitPicker()}
	<div class="flex items-center gap-2" data-slot="omit-status">
		<span class="text-muted-foreground text-xs font-medium">Omit sets status</span>
		<Select.Root type="single" value={omit.current} onValueChange={(v) => onOptions(withOmitStatus(options, v))}>
			<Select.Trigger size="sm" aria-label="Omit status" class="min-w-24">
				<span data-slot="select-value">{omit.current || 'pick a status'}</span>
			</Select.Trigger>
			<Select.Content>
				{#each omit.statuses as s (s)}
					<Select.Item value={s} label={s} />
				{/each}
			</Select.Content>
		</Select.Root>
		<span class="text-muted-foreground text-xs">The project has no <span class="font-mono">omt</span>.</span>
	</div>
{/snippet}

<section class="border-border flex shrink-0 flex-col border-b" data-slot="plan-bulk" aria-label="Run options">
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2">
		<button
			type="button"
			class="hover:bg-muted -mx-2 flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
			aria-expanded={open}
			onclick={onToggle}
			data-slot="run-options-toggle"
		>
			<ChevronRight class={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden="true" />
			<span class="shrink-0 text-sm font-semibold">Run options</span>
			<span class="text-muted-foreground truncate text-xs" data-slot="run-options-summary" title={summary}>{summary}</span>
		</button>
		{#if omit.ask && !open}{@render omitPicker()}{/if}
	</div>

	{#if open}
		<div class="flex flex-col gap-4 px-6 pt-1 pb-4">
			<div class="flex flex-col gap-2" data-slot="policy-fields">
				<div class="flex flex-col gap-0.5">
					<p class="text-xs font-medium">Fields the template rewrites</p>
					<p class="text-muted-foreground text-xs">
						Applying the template overwrites these fields on your existing Tasks, only those the template has a value for. For each:
						keep yours, or take the template's?
					</p>
				</div>
				<div class="grid grid-cols-[repeat(auto-fill,24rem)] gap-x-6 gap-y-1.5">
					{#each fields as f (f.field)}
						<div class="flex items-center gap-2">
							<span class="w-32 truncate text-xs" title={f.field}>{fieldLabel(labels, f.field)}</span>
							<Segmented
								label={`Policy for ${fieldLabel(labels, f.field)}`}
								value={f.policy}
								options={f.choices.map((c) => ({ value: c, label: policyChoice(c).short, title: policyChoice(c).long }))}
								onChange={(v) => onOptions(withFieldPolicy(options, f.field, v as FieldPolicy))}
							/>
						</div>
					{/each}
				</div>
				<p class="text-muted-foreground text-xs">
					<span class="text-foreground font-medium">Yours</span>: written back after the apply ·
					<span class="text-foreground font-medium">Template's</span>: the template's value ·
					<span class="text-foreground font-medium">Template's if empty</span>: only where yours is empty.
				</p>
				<p class="text-muted-foreground text-xs" data-slot="policy-note">
					Not listed: Flow Production Tracking always fills empty assignees and dates from the template (undo empties them again; dates
					only on Tasks with no dependency upstream). Status is never touched.
				</p>
			</div>

			{#if names.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-xs font-medium">Extras by name <span class="text-muted-foreground font-normal">· Tasks not in the template, by name on every entity</span></p>
					<div class="grid grid-cols-[repeat(auto-fill,20rem)] gap-x-6 gap-y-1.5">
						{#each names as n (n.name)}
							<div class="flex items-center gap-2">
								<span class="w-28 truncate text-xs" title={n.name}>{n.name || '(no name)'} <span class="text-muted-foreground tabular-nums">×{n.count}</span></span>
								<Segmented
									label={`Action for extras named ${n.name}`}
									value={options.extraByName[n.name] ?? 'leave'}
									options={EXTRA_OPTIONS}
									reselect
									onChange={(v) => onOptions(withExtraNameAction(options, n.name, v as ExtraAction, plans))}
								/>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
				{#if omit.ask}
					{@render omitPicker()}
				{:else}
					<p class="text-xs" data-slot="omit-status">
						<span class="text-muted-foreground font-medium">Omit sets status</span> <span class="font-mono">{options.omitStatus}</span>
					</p>
				{/if}
				{#if clearable > 0}
					<label class="flex items-center gap-2 text-xs" data-slot="clear-dates">
						<Switch checked={options.clearCreatedDates} onCheckedChange={(on) => onOptions(withClearCreatedDates(options, on))} />
						Clear template dates on {clearable} created Task{clearable === 1 ? '' : 's'} with no upstream (097)
					</label>
				{/if}
			</div>
			{#if footer}{@render footer()}{/if}
		</div>
	{/if}
</section>
