<!--
	On app start: runs the undo store holds with no finish (a tab closed mid-run, brief 6). Continue
	opens the plan at once, which loads while it recovers what landed unseen and re-plans what
	never landed from a fresh read; Review and undo opens the run on the result screen; Close stops offering it.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { session } from '$lib/app/apply.svelte';
	import { lineCounts, linesFromRun } from '$lib/pure/apply-view';
	import { Button } from '$lib/components/ui/button/index.js';
	import Notice from './notice.svelte';

	let busy = $state<string | null>(null);
	let message = $state<string | null>(null);

	onMount(() => void session.refreshUnfinished());

	const hidden = $derived(page.url.pathname.startsWith('/apply') || page.url.pathname.startsWith('/result') || page.url.pathname.startsWith('/connect'));
	const runs = $derived(session.unfinished.map((r) => ({ run: r, counts: lineCounts(linesFromRun(r)) })));

	/** Straight to the plan: it shows the recover and the reads as loading, and any error. */
	async function resume(id: string): Promise<void> {
		busy = id;
		message = null;
		const outcome = session.continueRun(id);
		void goto('/plan');
		try {
			if ((await outcome) === 'closed') message = 'Nothing left to apply on that run: it is closed. Review it from its undo record.';
		} finally {
			busy = null;
		}
	}
</script>

{#if !hidden && (runs.length || message)}
	<div class="border-border flex shrink-0 flex-col gap-2 border-b px-6 py-2" data-slot="resume-banner">
		{#each runs as { run: r, counts } (r.id)}
			<Notice tone="warning" title="An apply did not finish. ">
				<span class="font-medium">{r.template.code}</span>, started {r.startedAt.slice(0, 16).replace('T', ' ')}:
				<span class="tabular-nums">{counts.landed} applied, {counts.landing} applying when it stopped, {counts.failed} failed, {counts.pending} not started.</span>
				{#snippet action()}
					<Button size="sm" variant="ghost" onclick={() => void session.close(r.id)} disabled={busy !== null}>Close</Button>
					<Button size="sm" variant="outline" href={`/result?run=${r.id}`}>Review and undo</Button>
					<Button size="sm" onclick={() => void resume(r.id)} disabled={busy !== null}>{busy === r.id ? 'Re-planning…' : 'Continue'}</Button>
				{/snippet}
			</Notice>
		{/each}
		{#if message}<Notice tone="info">{message}</Notice>{/if}
	</div>
{/if}
