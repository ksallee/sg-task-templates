<!-- One entity's state on the apply and result screens, as a small labelled pill. -->
<script lang="ts">
	import type { LineState } from '$lib/pure/apply-view';
	import type { ResultKind } from '$lib/pure/result-view';

	let { state }: { state: LineState | ResultKind } = $props();

	const LABEL: Record<LineState | ResultKind, string> = {
		pending: 'Pending',
		landing: 'Landing',
		landed: 'Landed',
		failed: 'Failed',
		cancelled: 'Cancelled',
		undone: 'Undone',
		clean: 'Landed, clean',
		differences: 'Landed, with differences',
		not_applied: 'Not applied'
	};

	const TONE: Record<LineState | ResultKind, string> = {
		pending: 'bg-muted text-muted-foreground',
		landing: 'bg-primary/15 text-primary animate-pulse',
		landed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
		clean: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
		differences: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
		failed: 'bg-destructive/15 text-destructive',
		cancelled: 'bg-muted text-muted-foreground',
		not_applied: 'bg-muted text-muted-foreground',
		undone: 'bg-sky-500/15 text-sky-700 dark:text-sky-400'
	};
</script>

<span class={['inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium', TONE[state]].join(' ')} data-slot="line-state" data-state={state}>
	{LABEL[state]}
</span>
