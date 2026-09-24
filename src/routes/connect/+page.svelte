<!--
	Connect: name a Flow PT site and sign in as yourself through the App Session Launcher.
	Adapted from sg-notes' site bar, thinned to what this screen needs: no project pick yet,
	that is Template and Entities' problem once they exist.
-->
<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { prepareLive, setSiteUrl, signIn, signOut, whoAmI, type LiveState } from '$lib/live';

	let editingSite = $state(false);
	let siteDraft = $state('');
	let approving = $state(false);
	let refusal = $state<string | null>(null);

	function useSite(): void {
		const value = siteDraft.trim();
		if (!value) return;
		setSiteUrl(value);
		location.reload();
	}

	async function onSignIn(live: LiveState): Promise<void> {
		refusal = null;
		approving = true;
		try {
			await signIn(live.siteUrl, (url) => window.open(url, '_blank', 'noopener'));
			location.reload();
		} catch (error) {
			refusal = error instanceof Error ? error.message : String(error);
		} finally {
			approving = false;
		}
	}

	function onSignOut(): void {
		signOut();
		location.reload();
	}
</script>

<svelte:head><title>Connect · SG Task Templates</title></svelte:head>

<div class="flex flex-1 flex-col items-start gap-4 p-6">
	{#await prepareLive()}
		<p class="text-muted-foreground text-sm">Reaching the site…</p>
	{:then live}
		{@const editing = editingSite || live.siteUrl === ''}
		<div class="flex items-center gap-2">
			{#if editing}
				<Input class="h-8 w-80" type="url" placeholder="https://studio.shotgrid.autodesk.com" bind:value={siteDraft} onkeydown={(event) => event.key === 'Enter' && useSite()} />
				<Button size="sm" variant="outline" onclick={useSite}>Use site</Button>
				{#if live.siteUrl}
					<Button size="sm" variant="ghost" onclick={() => (editingSite = false)}>Cancel</Button>
				{/if}
			{:else}
				<span class="text-sm">Site <span class="text-muted-foreground">{live.siteUrl}</span></span>
				<Button size="sm" variant="ghost" onclick={() => ((siteDraft = live.siteUrl), (editingSite = true))}>Change</Button>
			{/if}
		</div>

		{#if live.session}
			{#await whoAmI()}
				<span class="text-muted-foreground text-sm">{live.session.login}</span>
			{:then person}
				{@const name = (person?.attributes.name as string | undefined) ?? live.session.login}
				<p class="text-sm">Signed in as <span class="font-medium">{name}</span></p>
			{/await}
			<Button size="sm" variant="ghost" onclick={onSignOut}>Sign out</Button>
		{:else if live.siteUrl && !editing}
			{#if refusal}
				<p class="text-destructive text-sm">{refusal}</p>
			{:else if approving}
				<p class="text-muted-foreground text-sm">Approve the request in the tab that opened.</p>
			{:else if live.devToken}
				<p class="text-muted-foreground text-xs">Reading through the dev key. Sign in to write as yourself.</p>
			{/if}
			<Button size="sm" variant={live.devToken ? 'outline' : 'default'} onclick={() => onSignIn(live)} disabled={approving}>
				{live.devToken ? 'Sign in as yourself' : 'Sign in'}
			</Button>
		{/if}

		{#if live.problem}
			<p class="text-muted-foreground text-sm">{live.problem}</p>
		{:else}
			<Button size="sm" href="/template">Next: template</Button>
		{/if}
	{:catch error}
		<p class="text-destructive text-sm">{error.message}</p>
	{/await}
</div>
