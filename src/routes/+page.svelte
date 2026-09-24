<!--
	Home: what the app does, why, how to use it, what it never does. One screen, one Start.
	Outside the step flow (`$lib/pure/flow.ts`: no step is current here). The rules in full: /how.
-->
<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import PageHeader from '$lib/app/page-header.svelte';
	import Section from '$lib/app/section.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const FORUM = 'https://community.shotgridsoftware.com/t/20654';

	const steps: Array<[string, string]> = [
		['Connect', 'Name the Flow PT site. Sign in as yourself.'],
		['Template', 'Pick the project, the entity type and the template.'],
		['Entities', 'Those using the template, any you pick, or those with none.'],
		['Plan', 'Review each entity’s Tasks. Resolve conflicts. Choose what happens to fields and extras.'],
		['Apply', 'One entity at a time. A failure stops that entity only.'],
		['Result', 'What landed. Undo is kept per run.']
	];

	const never = [
		'Writes before you have seen the plan.',
		'Deletes a Task without asking twice.',
		'Changes a matched Task’s status. Only extras you mark Omit get a new status.'
	];
</script>

<svelte:head><title>SG Task Templates</title></svelte:head>

<PageHeader title="SG Task Templates" context="Apply a task template to entities that already have Tasks. Merge, don’t duplicate.">
	{#snippet actions()}
		<Button href="/how" variant="outline">How it works</Button>
		<Button href="/connect">Start <ArrowRight data-icon="inline-end" /></Button>
	{/snippet}
</PageHeader>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="flex w-full max-w-3xl flex-col gap-6 px-6 py-6 text-sm">
		<Section title="What it does">
			<p>
				It applies a task template to Shots, Assets and other entities that already have Tasks. A Task with
				the template task’s name and step is matched and kept, with its status, assignees and publishes.
				Only the missing Tasks are created. Every change is shown per entity before anything is written.
			</p>
		</Section>

		<Section title="Why">
			<p>
				Flow PT’s own apply matches Tasks only by a hidden link to the template task, never by name and step.
				Switch a Shot to an overlapping template and every Task is flagged: delete them and their publishes
				lose their Task, or keep them and get duplicates. See
				<a class="text-foreground underline underline-offset-2" href={FORUM} target="_blank" rel="noopener">forum topic 20654</a>.
			</p>
		</Section>

		<Section title="How">
			<ol class="flex flex-col">
				{#each steps as [name, line], i (name)}
					<li class="flex gap-3 py-1.5">
						<span
							class="border-border text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] leading-none font-semibold tabular-nums"
							aria-hidden="true">{i + 1}</span
						>
						<span><span class="font-medium">{name}.</span> <span class="text-muted-foreground">{line}</span></span>
					</li>
				{/each}
			</ol>
		</Section>

		<Section title="What it never does">
			<ul class="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
				{#each never as line (line)}<li>{line}</li>{/each}
			</ul>
		</Section>

		<p class="text-muted-foreground">
			The rules, one by one: <a class="text-foreground underline underline-offset-2" href="/how">How it works</a>.
		</p>
	</div>
</div>
