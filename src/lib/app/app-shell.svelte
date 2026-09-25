<!--
	The frame of every screen (docs/design.md): a h-12 header as sg-notes' (wordmark, the step
	indicator, the site and who reads it, the scheme switch), the resume banner, then the page.
	The header holds who and where; the page holds what this screen is about. Outside the flow
	(home, how it works) the step indicator is not drawn. On a phone the wordmark keeps its mark only
	while the steps show, so the header never overflows.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import { Button } from '$lib/components/ui/button/index.js';
	import { isDark, setMode } from '$lib/theme';
	import { prepareLive, type LiveState } from '$lib/live';
	import { flowSteps, inFlow } from '$lib/pure/flow';
	import { run } from './run.svelte';
	import { session } from './apply.svelte';
	import FlowSteps from './flow-steps.svelte';
	import ResumeBanner from './resume-banner.svelte';
	import Wordmark from './wordmark.svelte';

	let { children }: { children: Snippet } = $props();

	let live = $state<LiveState | null>(null);
	void prepareLive().then((value) => (live = value));

	const steps = $derived(
		flowSteps(page.url.pathname, {
			connected: live !== null && live.problem === null,
			templatePicked: run.project !== null && run.entityType !== null && run.templateId !== null,
			planned: run.plans.length > 0,
			runStarted: session.current !== null,
			runFinished: session.phase !== 'running'
		})
	);

	const flow = $derived(inFlow(steps));

	/** The site as the header names it: the studio, without the suffix every Flow PT host carries (as sg-notes). */
	function shortHost(siteUrl: string): string {
		try {
			return new URL(siteUrl).hostname.replace(/^www\./, '').replace(/\.(?:shotgrid\.autodesk\.com|shotgunstudio\.com)$/, '');
		} catch {
			return siteUrl;
		}
	}

	let dark = $state(isDark());

	// In `system` mode the OS can flip the scheme under the page; the icon and label follow it.
	$effect(() => {
		const media = matchMedia('(prefers-color-scheme: dark)');
		const follow = (): void => {
			dark = isDark();
		};
		media.addEventListener('change', follow);
		return () => media.removeEventListener('change', follow);
	});

	function toggleScheme(): void {
		const next = dark ? 'light' : 'dark';
		setMode(next);
		dark = isDark(next);
	}
</script>

<div class="bg-background text-foreground flex h-dvh flex-col">
	<header class="border-border bg-background flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:gap-5 sm:px-4" data-slot="app-header">
		<a href="/" class="focus-visible:ring-ring shrink-0 rounded-md text-sm outline-none focus-visible:ring-2" aria-label="SG Task Templates, home">
			<Wordmark collapse={flow} />
		</a>

		<div class="flex min-w-0 flex-1 items-center">
			{#if flow}<FlowSteps {steps} />{/if}
		</div>

		<div class="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
			{#if live?.siteUrl}
				<a
					href="/connect"
					class="text-muted-foreground hover:text-foreground focus-visible:ring-ring hidden max-w-64 min-w-0 items-center gap-1.5 truncate rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 lg:flex"
					title={`${live.siteUrl}${live.session ? ` · ${live.session.login}` : live.devToken ? ' · dev key' : ''}`}
					data-slot="site-who"
				>
					<span class="text-xs">Site</span>
					<span class="text-foreground truncate">{shortHost(live.siteUrl)}</span>
					{#if live.session}
						<span aria-hidden="true">·</span><span class="truncate">{live.session.login}</span>
					{:else if live.devToken}
						<span aria-hidden="true">·</span><span class="text-xs">Dev key</span>
					{/if}
				</a>
			{/if}
			<Button size="icon" variant="ghost" href="/how" aria-label="How it works" title="How it works"><CircleHelp aria-hidden="true" /></Button>
			<Button size="icon" variant="ghost" onclick={toggleScheme} aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Switch to light' : 'Switch to dark'}>
				{#if dark}
					<Moon aria-hidden="true" />
				{:else}
					<Sun aria-hidden="true" />
				{/if}
			</Button>
		</div>
	</header>
	<ResumeBanner />
	<main class="flex min-h-0 flex-1 flex-col">
		{@render children()}
	</main>
</div>
