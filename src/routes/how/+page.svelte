<!--
	How it works: the app's rules, for a producer. Each rule rests on BRIEF.md's decisions
	and the sg-groundtruth findings noted beside it in comments; none is stated stronger than
	measured. Anchors come from `$lib/pure/how.ts`, which `HowLink` links to. A docs page: the
	sections in a side nav (sticky on wide screens, `activeSection` marks where you are), the text
	at a reading measure, a small picture where it clarifies a rule.
-->
<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import { KIND_LABEL } from '$lib/app/count-chip.svelte';
	import OutcomeGlyph from '$lib/app/how/outcome-glyph.svelte';
	import EdgeStrip from '$lib/app/how/edge-strip.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { activeSection, HOW_SECTIONS, type HowSectionId } from '$lib/pure/how';
	import type { PlanKind } from '$lib/pure/types';
	import { cn } from '$lib/utils.js';

	const title = (id: HowSectionId): string => HOW_SECTIONS.find((s) => s.id === id)?.title ?? id;

	const outcomes: Array<[PlanKind, string]> = [
		// decisions 9; 084/102: a linked Task is re-synced, not re-created.
		['keep', 'Linked to this template before the apply. Its fields are handled as under Fields.'],
		// recipe 015, 098: the link is written first, then the apply treats the Task as its own.
		['claim', 'Matched by name and Step, not linked yet. The app links it to the template task. No new Task.'],
		// 083: fields, dependencies, dates as the same calendar dates.
		['create', 'Missing on the entity, created from the template: Step, duration, estimate, description, assignees, dependencies and dates.'],
		['extra', 'On the entity, not in the template. Not changed unless requested.'],
		['conflict', 'Several Tasks match one template task. You pick one. Apply waits until every choice is made.']
	];

	// 102, 108: what each choice leaves on a kept or claimed Task. Empty never clears; an unticked
	// milestone on the template leaves the Task's; fill-if-empty is not offered for tick boxes.
	const fieldRows: Array<[string, string, string, string, string, string]> = [
		['Estimate', '3 days', '5 days', '3 days', '5 days', '3 days'],
		['Description', 'empty', 'Final comp', 'empty', 'Final comp', 'Final comp'],
		['Milestone', 'checked', 'unchecked', 'checked', 'checked', 'not offered']
	];

	let pane = $state<HTMLElement | null>(null);
	let active = $state<HowSectionId>(HOW_SECTIONS[0].id);

	function spy(): void {
		if (!pane) return;
		const top = pane.getBoundingClientRect().top;
		const tops = HOW_SECTIONS.flatMap((s) => {
			const el = document.getElementById(s.id);
			return el ? [{ id: s.id, top: el.getBoundingClientRect().top - top }] : [];
		});
		const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4;
		active = activeSection(tops, 120, atEnd) ?? active;
	}

	$effect(() => {
		spy();
	});

	const link = 'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';
	const h2 = 'scroll-mt-8 text-xl font-semibold tracking-tight';
	const h3 = 'scroll-mt-8 pt-2 text-base font-semibold';
	const section = 'flex flex-col gap-4 border-t pt-10';
	const list = 'flex list-disc flex-col gap-1.5 pl-5 marker:text-muted-foreground';
</script>

<svelte:head><title>How it works · SG Task Templates</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="how" bind:this={pane} onscroll={spy}>
	<div class="mx-auto grid w-full max-w-5xl gap-10 px-4 pt-10 pb-20 sm:px-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-14 lg:pt-14">
		<nav aria-label="On this page" class="sticky top-14 hidden self-start lg:block">
			<p class="text-muted-foreground pb-3 text-xs font-medium">On this page</p>
			<ul class="border-border flex flex-col border-l text-sm">
				{#each HOW_SECTIONS as s (s.id)}
					<li>
						<a
							href={`#${s.id}`}
							class={cn(
								'-ml-px block border-l-2 py-1 pl-3 transition-colors duration-150',
								active === s.id ? 'border-primary text-foreground font-medium' : 'text-muted-foreground hover:text-foreground border-transparent'
							)}
							aria-current={active === s.id ? 'location' : undefined}>{s.title}</a
						>
					</li>
				{/each}
			</ul>
			<Button href="/connect" class="mt-6" size="sm">Start</Button>
		</nav>

		<article class="flex max-w-[42rem] min-w-0 flex-col gap-10 text-[0.9375rem] leading-relaxed">
			<header class="flex flex-col gap-3">
				<h1 class="text-3xl leading-tight font-semibold tracking-tight">How it works</h1>
				<p class="text-muted-foreground text-base">What the app does to your Tasks, rule by rule.</p>
				<nav aria-label="On this page" class="flex flex-wrap gap-x-4 gap-y-1.5 pt-2 text-sm lg:hidden">
					{#each HOW_SECTIONS as s (s.id)}
						<a class="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline" href={`#${s.id}`}>{s.title}</a>
					{/each}
				</nav>
			</header>

			<!-- decisions 2; matching.ts -->
			<section class={section}>
				<h2 id="matching" class={h2}>{title('matching')}</h2>
				<p>Each Task on an entity is matched to a template task by two things: its name and its Pipeline Step.</p>
				<p>
					Names are compared loosely: case and spaces at the ends are ignored, several spaces in a row count as one.
					The plan shows what each Task matched on.
				</p>
				<figure class="bg-card flex flex-col rounded-lg border text-sm" aria-label="Name matching examples">
					<figcaption class="text-muted-foreground border-b px-4 py-2 text-xs">Task names against the template task “Comp”, same Step</figcaption>
					<div class="flex flex-col gap-1.5 px-4 py-3">
						{#each [['“Comp ”', true], ['“comp”', true], ['“COMP”', true], ['“Compositing”', false]] as [name, match] (name)}
							<div class="flex items-center gap-3">
								<code class="font-mono text-xs whitespace-pre">{name}</code>
								<span class={cn('ml-auto flex items-center gap-1 text-xs font-medium', match ? 'text-success' : 'text-muted-foreground')}>
									{#if match}<Check class="size-3.5" aria-hidden="true" />matches{:else}<Minus class="size-3.5" aria-hidden="true" />no match{/if}
								</span>
							</div>
						{/each}
					</div>
				</figure>
				<p>A Task already linked to a task of this template stays linked, whatever its name.</p>
				<p>
					A Task linked to another template’s task, with the same name and Step, is linked to this one. The plan shows
					its old link. Undo restores it.
				</p>
				<h3 class={h3}>Several matches</h3>
				<p>Two Tasks on one entity match one template task: you pick which one. The plan pre-picks, in this order:</p>
				<ol class="flex list-decimal flex-col gap-1.5 pl-5 marker:text-muted-foreground">
					<li>the Task with Versions or published files;</li>
					<li>then the one whose status is not the project’s default;</li>
					<li>then the oldest.</li>
				</ol>
				<p>
					The other becomes Not in template. If one of the two is already linked to this template’s task, it stays linked and
					there is no choice to make. A template with two tasks of the same name and Step needs a choice too.
				</p>
			</section>

			<section class={section}>
				<h2 id="outcomes" class={h2}>{title('outcomes')}</h2>
				<p>The plan gives each Task one of five outcomes. In each picture, the entity’s Task is on the left, the template task on the right.</p>
				<dl class="bg-card flex flex-col divide-y rounded-lg border">
					{#each outcomes as [kind, meaning] (kind)}
						<div id={kind} class="flex scroll-mt-8 flex-col gap-2 p-4 sm:flex-row sm:gap-4">
							<dt class="flex w-56 shrink-0 items-center gap-3 self-start font-medium">
								<OutcomeGlyph {kind} />{KIND_LABEL[kind]}
							</dt>
							<dd class="text-muted-foreground text-sm sm:pt-1">{meaning}</dd>
						</div>
					{/each}
				</dl>
			</section>

			<!-- 102, 108; decisions 4 -->
			<section class={section}>
				<h2 id="fields" class={h2}>{title('fields')}</h2>
				<p>
					On existing Tasks linked to the template, Flow PT overwrites a field when the
					template task has a value: name, Step, estimate, description, sort order, reviewers, milestone and custom
					fields. Duration too, on a Task with no dates.
				</p>
				<p>
					An empty value on the template never clears a field. A 0 counts as a value: an estimate of 0 overwrites. An
					unchecked milestone on the template leaves the Task’s unchanged.
				</p>
				<p>For each of those fields you choose, once per run:</p>
				<ul class={list}>
					<li><span class="font-medium">Keep</span> (default). The app reads the value before the apply and writes it back after, in the same request.</li>
					<li><span class="font-medium">Template’s.</span> The template’s value.</li>
					<li><span class="font-medium">Fill if empty.</span> The template’s value only where the Task has none. Not for the name, the Step, or checkboxes such as milestone.</li>
				</ul>
				<figure class="flex flex-col gap-2">
					<div class="overflow-x-auto rounded-lg border">
						<table class="bg-card w-full min-w-[34rem] text-sm">
							<thead class="text-muted-foreground text-xs">
								<tr class="border-b">
									<th class="px-3 py-2 text-left font-medium">Field</th>
									<th class="px-3 py-2 text-left font-medium">Task has</th>
									<th class="border-r px-3 py-2 text-left font-medium">Template has</th>
									<th class="px-3 py-2 text-left font-medium">Keep</th>
									<th class="px-3 py-2 text-left font-medium">Template’s</th>
									<th class="px-3 py-2 text-left font-medium">Fill if empty</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each fieldRows as [field, task, tpl, keep, theirs, fill] (field)}
									<tr>
										<td class="px-3 py-2 font-medium">{field}</td>
										{#each [task, tpl] as v, i (i)}
											<td class={cn('text-muted-foreground px-3 py-2', i === 1 && 'border-r', v === 'empty' && 'italic')}>{v}</td>
										{/each}
										{#each [keep, theirs, fill] as v, i (i)}
											<td class={cn('px-3 py-2', (v === 'empty' || v === 'not offered') && 'text-muted-foreground italic')}>{v}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<figcaption class="text-muted-foreground text-xs">What an existing linked Task ends with, per choice.</figcaption>
				</figure>
				<p>
					The name is the exception: the template’s by default. The plan lists renames, with a warning when someone
					renamed the Task by hand.
				</p>
				<p>
					Assignees are filled from the template only when the Task has none. Start and due dates are kept when set,
					filled from the template when empty. Status is never changed.
				</p>
			</section>

			<!-- decisions 3; 089 -->
			<section class={section}>
				<h2 id="extras" class={h2}>{title('extras')}</h2>
				<p>Tasks on the entity that the template lacks. Each gets one action. Set them in bulk by name.</p>
				<dl class="grid gap-3 sm:grid-cols-3">
					<div class="bg-card flex flex-col gap-1 rounded-lg border p-4">
						<dt class="font-medium">Leave <span class="text-muted-foreground text-xs font-normal">default</span></dt>
						<dd class="text-muted-foreground text-sm">Not changed.</dd>
					</div>
					<div class="bg-card flex flex-col gap-1 rounded-lg border p-4">
						<dt class="font-medium">Omit</dt>
						<dd class="text-muted-foreground text-sm">Its status is set to the project’s omit status. Undo restores the old one.</dd>
					</div>
					<div class="bg-card border-destructive/40 flex flex-col gap-1 rounded-lg border p-4">
						<dt class="font-medium">Delete</dt>
						<dd class="text-muted-foreground text-sm">Asks twice.</dd>
					</div>
				</dl>
				<p>
					A Task with Versions or published files can be deleted, with a warning that shows the counts. They stay, with no
					Task. Undo revives the Task and links them to it again.
				</p>
			</section>

			<!-- 085, 092, 093, 097, 099, 101, 102, 107, 109 -->
			<section class={section}>
				<h2 id="dependencies" class={h2}>{title('dependencies')}</h2>
				<p>
					The apply adds the template dependencies missing between the Tasks it links, existing or created.
				</p>
				<h3 id="edges-removed" class={h3}>Dependencies Flow PT removes</h3>
				<p>The same apply also removes some dependencies, and they can’t be restored afterwards:</p>
				<ul class={list}>
					<li>between two linked Tasks, one the template doesn’t have;</li>
					<li>between two linked Tasks, one of another type, offset or direction: the template’s replaces it;</li>
					<li>a linked Task that depends on a Task outside the template: a Task not in the template, another template’s Task, a Task on another entity.</li>
				</ul>
				<p>A Task outside the template that depends on a linked Task keeps its dependency.</p>
				<EdgeStrip />
				<p>
					The plan lists each one. <span class="font-medium">Keep</span> (default) re-creates it after the apply,
					same type and offset. <span class="font-medium">Remove</span> leaves it removed. If re-creating one would close a loop,
					Flow PT refuses it and the entity’s whole apply fails, so it defaults to Remove and the plan warns.
				</p>
				<h3 id="dates" class={h3}>Dates that may move</h3>
				<p>
					A new or re-created dependency moves its downstream Task at once, unless that Task is pinned. The plan
					lists the Tasks that may move. A pinned Task keeps its dates; the plan shows those that would be flagged with a
					dependency violation. Flow PT pins a Task with an upstream dependency when its start date is set by hand.
				</p>
				<p>
					Created Tasks take the template’s dates, as the same calendar dates. On a created Task with no upstream dependency,
					you can clear them; it stays unpinned with no dates.
				</p>
			</section>

			<!-- decisions 6; 087, 093, 095, 097, 101, 103, 110, 111, 112; recipes 019, 022, 023 -->
			<section class={section}>
				<h2 id="undo" class={h2}>{title('undo')}</h2>
				<p>
					Each entity’s apply is one request: all of it is written, or none of it. A failure stops that entity only; the
					result lists it with a retry.
				</p>
				<p>
					The app stores an undo record per entity as it is applied, in this browser and as a download. Undo works
					from either. A tab closed mid-run offers the run again on reopen: continue it or undo it.
				</p>
				<div class="grid gap-3 sm:grid-cols-2">
					<div class="bg-card flex flex-col gap-3 rounded-lg border p-4">
						<h3 class="text-sm font-semibold">Undo restores</h3>
						<ul class="flex flex-col gap-2 text-sm">
							{#each ['the entity’s old template, and the old links of Linked Tasks;', 'the fields as they were, names included, and assignees the apply filled;', 'the statuses of omitted Tasks;', 'deleted Tasks, revived with their Versions and published files;', 'dependencies, matched by their Tasks, type and offset.'] as line (line)}
								<li class="flex gap-2"><Check class="text-success mt-1 size-3.5 shrink-0" aria-hidden="true" />{line}</li>
							{/each}
						</ul>
						<p class="text-sm">It deletes the Tasks the run created.</p>
					</div>
					<div class="bg-card flex flex-col gap-3 rounded-lg border p-4">
						<h3 class="text-sm font-semibold">Not exactly</h3>
						<ul class="text-muted-foreground flex flex-col gap-2 text-sm">
							<li class="flex gap-2">
								<Minus class="mt-1 size-3.5 shrink-0" aria-hidden="true" /><span
									>Dates. Restored dependencies reschedule from the upstream Task as it is now. Dates the apply filled on a
									Task that had none are cleared only on a Task with no upstream dependency; elsewhere they stay, and the
									result says so.</span
								>
							</li>
							<li class="flex gap-2">
								<Minus class="mt-1 size-3.5 shrink-0" aria-hidden="true" />Some dependencies are re-created as new ones: same
								Tasks, type and offset, a new id.
							</li>
							<li class="flex gap-2"><Minus class="mt-1 size-3.5 shrink-0" aria-hidden="true" />A pinned Task’s dependency violation flag may differ.</li>
						</ul>
					</div>
				</div>
			</section>

			<!-- 052, 090, 094, recipe 017 (partial) -->
			<section class={section}>
				<h2 id="permissions" class={h2}>{title('permissions')}</h2>
				<p>
					The app writes as you, signed in through Flow PT’s App Session Launcher. Changes are in the event log under
					your name. It can do nothing you can’t.
				</p>
				<p>
					Flow PT has no way to ask what you may do. Before the plan, the app reads which fields you can edit, then tries
					an update, a create and a delete that Flow PT refuses before anything is written. If a write the plan needs looks
					refused, it warns.
				</p>
				<p>
					It’s a hint. Measured for a script user acting as an Artist; unmeasured for a person signed in. A write refused
					during the apply is reported per entity.
				</p>
			</section>

			<footer class="text-muted-foreground flex flex-col gap-4 border-t pt-8 text-sm sm:flex-row sm:items-center sm:justify-between">
				<p>
					What Flow PT does here is measured live. The record: <a
						class={link}
						href="https://github.com/ksallee/sg-groundtruth"
						target="_blank"
						rel="noopener">sg-groundtruth</a
					>.
				</p>
				<Button href="/connect" class="self-start sm:self-auto">Start</Button>
			</footer>
		</article>
	</div>
</div>
