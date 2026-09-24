<!--
	How it works: the rules the app follows, for a producer. Each rule rests on BRIEF.md's decisions
	and the sg-groundtruth findings noted beside it in comments; none is stated stronger than
	measured. Anchors come from `$lib/pure/how.ts`, which `HowLink` links to.
-->
<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PageHeader from '$lib/app/page-header.svelte';
	import { KIND_DOT, KIND_LABEL } from '$lib/app/count-chip.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { HOW_SECTIONS, type HowSectionId } from '$lib/pure/how';
	import type { PlanKind } from '$lib/pure/types';
	import { cn } from '$lib/utils.js';

	const title = (id: HowSectionId): string => HOW_SECTIONS.find((s) => s.id === id)?.title ?? id;

	const outcomes: Array<[PlanKind, string]> = [
		// decisions 9; 084/102: a linked Task is re-synced, not re-created.
		['keep', 'Already linked to this template’s task. Nothing new is linked. Its fields still follow the rules under Fields.'],
		// recipe 015, 098: the link is written first, then the apply treats the Task as its own.
		['claim', 'Same name and step, not linked yet. The app links it to the template task, then the apply treats it as its own. No new Task.'],
		// 083: fields, dependencies, dates as the same calendar dates.
		['create', 'Nothing matches. The apply creates the Task from the template: step, duration, estimate, description, assignees, dependencies and dates.'],
		['extra', 'On the entity, not in the template. Left alone unless you say otherwise.'],
		['conflict', 'Two candidates for one template task. You pick. Apply waits until every conflict is resolved.']
	];

	const link = 'text-foreground underline underline-offset-2';
	const h2 = 'scroll-mt-4 text-base font-semibold';
	const h3 = 'scroll-mt-4 text-sm font-semibold';
</script>

<svelte:head><title>How it works · SG Task Templates</title></svelte:head>

<PageHeader title="How it works" context="What the app does to your Tasks, rule by rule.">
	{#snippet actions()}
		<Button href="/connect">Start <ArrowRight data-icon="inline-end" /></Button>
	{/snippet}
</PageHeader>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="how">
	<div class="flex w-full max-w-3xl flex-col gap-8 px-6 py-6 text-sm leading-relaxed">
		<nav aria-label="On this page" class="flex flex-wrap gap-x-4 gap-y-1">
			{#each HOW_SECTIONS as s (s.id)}
				<a class="text-muted-foreground hover:text-foreground" href={`#${s.id}`}>{s.title}</a>
			{/each}
		</nav>

		<!-- decisions 2; matching.ts -->
		<section class="flex flex-col gap-3">
			<h2 id="matching" class={h2}>{title('matching')}</h2>
			<p>Each Task on an entity is matched to a template task by two things: its name and its step.</p>
			<p>
				Names are compared loosely. Spaces at the ends are dropped, runs of spaces count as one, case is
				ignored. “Comp ”, “comp” and “COMP” match. “Comp” and “Compositing” don’t. The plan shows what each
				Task matched on.
			</p>
			<p>A Task already linked to a task of this template stays with it, whatever its name. The link wins.</p>
			<p>
				A Task linked to another template’s task, with the same name and step, is claimed for this one. The plan
				shows its old link. Undo puts it back.
			</p>
			<h3 class={h3}>Conflicts</h3>
			<p>
				Two Tasks on one entity match one template task: you pick which one. The plan pre-picks, in this
				order:
			</p>
			<ol class="flex list-decimal flex-col gap-1 pl-5">
				<li>the Task with Versions or published files;</li>
				<li>then the one whose status is not the project’s default;</li>
				<li>then the oldest.</li>
			</ol>
			<p>
				The other becomes an extra. If one of the two is already linked to this template’s task, it wins
				outright: no conflict. A template with two tasks of the same name and step is a conflict too.
			</p>
		</section>

		<section class="flex flex-col gap-3">
			<h2 id="outcomes" class={h2}>{title('outcomes')}</h2>
			<p>The plan sorts every Task into one of five outcomes, per entity.</p>
			<dl class="flex flex-col gap-3">
				{#each outcomes as [kind, meaning] (kind)}
					<div id={kind} class="flex scroll-mt-4 gap-3">
						<dt class="flex w-20 shrink-0 items-center gap-2 self-start font-medium">
							<span class={cn('size-2 shrink-0 rounded-full', KIND_DOT[kind])} aria-hidden="true"></span>{KIND_LABEL[kind]}
						</dt>
						<dd class="text-muted-foreground">{meaning}</dd>
					</div>
				{/each}
			</dl>
		</section>

		<!-- 102, 108; decisions 4 -->
		<section class="flex flex-col gap-3">
			<h2 id="fields" class={h2}>{title('fields')}</h2>
			<p>
				Applying a template rewrites the Tasks it already holds, not only the new ones. On every kept or claimed
				Task, Flow PT overwrites a field when the template task has a value: name, step, estimate, description,
				sort order, reviewers, milestone and custom fields. Duration too, but only on a Task with no dates.
			</p>
			<p>
				An empty value on the template never clears a field. A 0 counts as a value: an estimate of 0 overwrites.
				An unticked milestone on the template leaves the Task’s alone.
			</p>
			<p>So for each of those fields you choose, once per run:</p>
			<ul class="flex list-disc flex-col gap-1 pl-5">
				<li><span class="font-medium">Keep</span> (default). The app reads the value before and writes it back right after, in the same step.</li>
				<li><span class="font-medium">Template’s.</span> The template’s value stays.</li>
				<li><span class="font-medium">Fill if empty.</span> The template’s value only where the Task has none. Not for the name, the step, or tick boxes such as milestone.</li>
			</ul>
			<p>
				The name is the exception: it takes the template’s by default. Every rename shows in the plan, loudly
				when someone renamed the Task by hand.
			</p>
			<p>
				Assignees are filled from the template only when the Task has none. Start and due dates are kept when set,
				filled from the template when empty. Status is never changed.
			</p>
		</section>

		<!-- decisions 3; 089 -->
		<section class="flex flex-col gap-3">
			<h2 id="extras" class={h2}>{title('extras')}</h2>
			<p>Tasks on the entity that the template lacks. Each gets one action. Set them in bulk by name.</p>
			<ul class="flex list-disc flex-col gap-1 pl-5">
				<li><span class="font-medium">Leave</span> (default). Untouched.</li>
				<li><span class="font-medium">Omit.</span> Its status is set to the project’s omit status. Undo puts the old one back.</li>
				<li>
					<span class="font-medium">Delete.</span> Asks twice. A Task with Versions or published files can be
					deleted, with a loud warning that shows the counts: they stay, but lose their Task. Undo revives the Task
					and they point at it again.
				</li>
			</ul>
		</section>

		<!-- 085, 092, 093, 097, 099, 101, 102, 107, 109 -->
		<section class="flex flex-col gap-3">
			<h2 id="dependencies" class={h2}>{title('dependencies')}</h2>
			<p>
				The apply adds every template dependency missing between the Tasks it links, whether they were kept,
				claimed or created.
			</p>
			<h3 id="edges-removed" class={h3}>Dependencies Flow PT removes</h3>
			<p>The same apply also removes some dependencies, and they can’t be restored afterwards:</p>
			<ul class="flex list-disc flex-col gap-1 pl-5">
				<li>between two linked Tasks, one the template doesn’t have;</li>
				<li>between two linked Tasks, one of another type, offset or direction: the template’s takes its place;</li>
				<li>a linked Task waiting on a Task outside the template: an extra, another template’s Task, a Task on another entity.</li>
			</ul>
			<p>An outside Task waiting on a linked one keeps its dependency.</p>
			<p>
				The plan lists each one. <span class="font-medium">Keep</span> (default) re-creates it right after the apply,
				same type and offset. <span class="font-medium">Remove</span> lets it go. If re-creating one would close a
				loop, Flow PT refuses it and the entity’s whole apply fails, so it defaults to Remove and the plan warns.
			</p>
			<h3 id="dates" class={h3}>Dates that may move</h3>
			<p>
				A new or re-created dependency moves the Task that waits on it at once, unless that Task is pinned. The
				plan lists the Tasks that may move. A pinned Task keeps its dates; the plan shows those that would be
				flagged with a dependency violation. Flow PT pins a Task that waits on another when its start date is set by hand.
			</p>
			<p>
				Created Tasks take the template’s dates, as the same calendar dates. On a created Task that waits on
				nothing, you can clear them; it stays unpinned with no dates.
			</p>
		</section>

		<!-- decisions 6; 087, 093, 095, 097, 101, 103, 110, 111, 112; recipes 019, 022, 023 -->
		<section class="flex flex-col gap-3">
			<h2 id="undo" class={h2}>{title('undo')}</h2>
			<p>
				Each entity’s apply is sent as one request: it lands whole, or not at all. A failure stops that entity only; the
				result lists it with a retry.
			</p>
			<p>
				Every run keeps an undo record, per entity as it lands. It lives in this browser and downloads as a file;
				undo works from either. A tab closed mid-run offers the run again on reopen: continue it or undo it.
			</p>
			<p>Undo puts back:</p>
			<ul class="flex list-disc flex-col gap-1 pl-5">
				<li>the entity’s old template, and the old links of claimed Tasks;</li>
				<li>the fields as they were, names included, and assignees the apply filled;</li>
				<li>the statuses of omitted Tasks;</li>
				<li>deleted Tasks, revived with their Versions and published files;</li>
				<li>dependencies, matched by their ends, type and offset.</li>
			</ul>
			<p>It deletes the Tasks the run created.</p>
			<p>What it can’t put back exactly:</p>
			<ul class="flex list-disc flex-col gap-1 pl-5">
				<li>
					Dates. Restored dependencies reschedule from the upstream Task as it is now. Dates the apply filled on a
					Task that had none are cleared only where nothing runs into the Task; elsewhere they stay, and the
					result says so.
				</li>
				<li>Some dependencies come back as new ones: same ends, type and offset, a new id.</li>
				<li>A pinned Task’s dependency violation flag may differ.</li>
			</ul>
		</section>

		<!-- 052, 090, 094, recipe 017 (partial) -->
		<section class="flex flex-col gap-3">
			<h2 id="permissions" class={h2}>{title('permissions')}</h2>
			<p>
				The app writes as you, signed in through Flow PT’s App Session Launcher. Every change is in the event log
				under your name. It can do nothing you can’t.
			</p>
			<p>
				Flow PT has no way to ask what you may do. Before the plan, the app reads which fields you can edit, then
				tries an update, a create and a delete that Flow PT refuses before anything lands. Nothing is written. If
				you look short of what the plan needs, it warns.
			</p>
			<p>
				It’s a hint, not a promise: measured for a scripted user acting as an Artist, not yet for a person signed
				in. A write refused during the apply is reported per entity.
			</p>
		</section>

		<p class="text-muted-foreground">
			What Flow PT does here is measured on a live site, not taken from its docs. The record: <a
				class={link}
				href="https://github.com/ksallee/sg-groundtruth"
				target="_blank"
				rel="noopener">sg-groundtruth</a
			>.
		</p>
	</div>
</div>
