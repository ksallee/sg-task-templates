<!--
	The top of every screen: the app name, the six screens in order, and the light/dark switch.
	Thin on purpose: the screens hold the logic, this only gets a person between them.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import { isDark, setMode } from '$lib/theme';

	const SCREENS: ReadonlyArray<{ href: string; label: string }> = [
		{ href: '/connect', label: 'Connect' },
		{ href: '/template', label: 'Template' },
		{ href: '/entities', label: 'Entities' },
		{ href: '/plan', label: 'Plan' },
		{ href: '/apply', label: 'Apply' },
		{ href: '/result', label: 'Result' }
	];

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

<header class="border-border bg-background flex h-12 shrink-0 items-center gap-5 border-b px-4" data-slot="nav-bar">
	<a href="/connect" class="focus-visible:ring-ring shrink-0 rounded-md text-sm font-semibold outline-none focus-visible:ring-2">
		SG Task Templates
	</a>

	<nav class="flex min-w-0 flex-1 items-center gap-1 text-sm" aria-label="Screens">
		{#each SCREENS as screen (screen.href)}
			<a
				href={screen.href}
				class={[
					'rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
					page.url.pathname.startsWith(screen.href) ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
				].join(' ')}
				aria-current={page.url.pathname.startsWith(screen.href) ? 'page' : undefined}
			>
				{screen.label}
			</a>
		{/each}
	</nav>

	<Button size="icon" variant="ghost" onclick={toggleScheme} aria-label={dark ? 'Switch to light' : 'Switch to dark'} title={dark ? 'Switch to light' : 'Switch to dark'}>
		{#if dark}
			<Moon aria-hidden="true" />
		{:else}
			<Sun aria-hidden="true" />
		{/if}
	</Button>
</header>
