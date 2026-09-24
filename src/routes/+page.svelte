<!--
	Home: what the app does, shown rather than told (`$lib/app/merge-picture.svelte`), then how to
	use it and what it never does. One centred column, one Start. Outside the step flow
	(`$lib/pure/flow.ts`: no step is current, the shell hides the steps). The rules in full: /how.
-->
<script lang="ts">
	import MergePicture from '$lib/app/merge-picture.svelte';
	import { Button } from '$lib/components/ui/button/index.js';

	const FORUM = 'https://community.shotgridsoftware.com/t/20654';

	const steps: Array<[string, string]> = [
		['Connect', 'Name the Flow PT site. Sign in as yourself.'],
		['Template', 'Pick the project, the entity type and the template.'],
		['Entities', 'Those on the template, any you pick, or those with none.'],
		['Plan', 'See each entity’s Tasks. Resolve conflicts. Choose what happens to fields and extras.'],
		['Apply', 'One entity at a time. A failure stops that entity only.'],
		['Result', 'What landed. Undo is kept per run.']
	];

	const never = [
		'Write before you have seen the plan.',
		'Delete a Task without asking twice.',
		'Change a matched Task’s status. Only extras you mark Omit get a new one.'
	];

	const link = 'text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground';
</script>

<svelte:head><title>SG Task Templates</title></svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto" data-slot="home">
	<div class="mx-auto flex w-full max-w-4xl flex-col gap-16 px-4 pt-12 pb-16 sm:px-6 sm:pt-16">
		<section class="flex flex-col items-center gap-10">
			<div class="flex max-w-2xl flex-col items-center gap-4 text-center">
				<h1 class="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
					Apply a task template to Shots that already have Tasks.
				</h1>
				<p class="text-muted-foreground max-w-xl text-base text-balance">
					Tasks are matched by name and step. Only the missing ones are created. You see every change before
					anything is written.
				</p>
				<div class="flex items-center gap-2 pt-2">
					<Button href="/connect" size="lg">Start</Button>
					<Button href="/how" size="lg" variant="ghost">How it works</Button>
				</div>
			</div>

			<MergePicture />

			<p class="text-muted-foreground -mt-4 text-center text-xs">
				Shots, Assets, Sequences: any entity with a task template. Why this exists: <a
					class={link}
					href={FORUM}
					target="_blank"
					rel="noopener">forum topic 20654</a
				>.
			</p>
		</section>

		<div class="grid gap-12 md:grid-cols-[2fr_1fr] md:gap-10">
			<section class="flex flex-col gap-4" aria-labelledby="home-how">
				<h2 id="home-how" class="text-lg font-semibold tracking-tight">Six steps</h2>
				<ol class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
					{#each steps as [name, line], i (name)}
						<li class="flex gap-3">
							<span
								class="border-border text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums"
								aria-hidden="true">{i + 1}</span
							>
							<div class="flex flex-col gap-0.5 text-sm">
								<span class="font-medium">{name}</span>
								<span class="text-muted-foreground">{line}</span>
							</div>
						</li>
					{/each}
				</ol>
			</section>

			<section class="flex flex-col gap-4" aria-labelledby="home-never">
				<h2 id="home-never" class="text-lg font-semibold tracking-tight">It never</h2>
				<ul class="flex flex-col gap-3 text-sm">
					{#each never as line (line)}
						<li class="border-border border-l-2 pl-3">{line}</li>
					{/each}
				</ul>
				<p class="text-muted-foreground pt-2 text-sm">
					Every rule, one by one: <a class={link} href="/how">How it works</a>.
				</p>
			</section>
		</div>
	</div>
</div>
