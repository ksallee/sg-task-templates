<!--
	Bulk actions for the whole run: a policy per field (102; keep by default, the name overwrites),
	one action per extra name, the omit status when the project has no `omt`, the clear-dates opt-in
	where a created Task may take it (097). Every change goes out as new RunOptions.
-->
<script lang="ts">
	import type { EntityPlan, ExtraAction, FieldPolicy, ProjectContext, RunOptions, Template } from '$lib/pure/types';
	import { extraNames, withFieldPolicy } from '$lib/pure/planner';
	import {
		EXTRA_ACTIONS,
		clearableCreates,
		omitChoice,
		policyFieldViews,
		withClearCreatedDates,
		withExtraNameAction,
		withOmitStatus
	} from '$lib/pure/plan-view';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as ToggleGroup from '$lib/components/ui/toggle-group/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';

	type Props = {
		template: Template;
		plans: EntityPlan[];
		ctx: ProjectContext;
		options: RunOptions;
		onOptions: (next: RunOptions) => void;
	};
	let { template, plans, ctx, options, onOptions }: Props = $props();

	const fields = $derived(policyFieldViews(template, options));
	const names = $derived(extraNames(plans));
	const omit = $derived(omitChoice(ctx, options));
	const clearable = $derived(clearableCreates(plans));
	const POLICY: Record<FieldPolicy, string> = { keep: 'keep', overwrite: 'overwrite', fill_if_empty: 'fill if empty' };
	const nameAction = (name: string): ExtraAction | '' => options.extraByName[name] ?? '';
</script>

<div class="flex flex-col gap-3 text-sm" data-slot="plan-bulk">
	<div class="flex flex-col gap-1">
		<p class="text-xs font-medium">Fields on kept and claimed Tasks</p>
		<div class="flex flex-wrap gap-x-4 gap-y-1">
			{#each fields as f (f.field)}
				<div class="flex items-center gap-1.5">
					<span class="font-mono text-xs">{f.field}</span>
					<ToggleGroup.Root
						type="single"
						size="sm"
						variant="outline"
						value={f.policy}
						onValueChange={(v) => v && onOptions(withFieldPolicy(options, f.field, v as FieldPolicy))}
						aria-label={`Policy for ${f.field}`}
					>
						{#each f.choices as c (c)}
							<ToggleGroup.Item value={c} class="px-2 text-xs">{POLICY[c]}</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				</div>
			{/each}
		</div>
	</div>

	{#if names.length > 0}
		<div class="flex flex-col gap-1">
			<p class="text-xs font-medium">Extras by name</p>
			<div class="flex flex-wrap gap-x-4 gap-y-1">
				{#each names as n (n.name)}
					<div class="flex items-center gap-1.5">
						<span class="text-xs">{n.name || '(no name)'} <span class="text-muted-foreground tabular-nums">×{n.count}</span></span>
						<ToggleGroup.Root
							type="single"
							size="sm"
							variant="outline"
							value={nameAction(n.name)}
							onValueChange={(v) => v && onOptions(withExtraNameAction(options, n.name, v as ExtraAction, plans))}
							aria-label={`Action for extras named ${n.name}`}
						>
							{#each EXTRA_ACTIONS as a (a)}
								<ToggleGroup.Item value={a} class="px-2 text-xs">{a}</ToggleGroup.Item>
							{/each}
						</ToggleGroup.Root>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-x-6 gap-y-2">
		<div class="flex items-center gap-2" data-slot="omit-status">
			<span class="text-xs font-medium">Omit sets status</span>
			{#if omit.ask}
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
			{:else}
				<span class="font-mono text-xs">{options.omitStatus}</span>
			{/if}
		</div>
		{#if clearable > 0}
			<label class="flex items-center gap-2 text-xs" data-slot="clear-dates">
				<Switch checked={options.clearCreatedDates} onCheckedChange={(on) => onOptions(withClearCreatedDates(options, on))} />
				Clear template dates on {clearable} created Task{clearable === 1 ? '' : 's'} with no upstream (097)
			</label>
		{/if}
	</div>
</div>
