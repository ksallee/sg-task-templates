<!--
	A small single choice among a few words (a field policy, an extra's action): a muted track, the
	chosen option raised on the card surface with a border, so the pick reads at a glance. A
	`destructive` option shows its tone once chosen. Tokens only.
-->
<script lang="ts" module>
	export type SegmentedOption = { value: string; label: string; tone?: 'destructive'; disabled?: boolean; title?: string };
</script>

<script lang="ts">
	import { cn } from '$lib/utils.js';

	let {
		value,
		options,
		onChange,
		label,
		reselect = false,
		class: className
	}: {
		value: string;
		options: SegmentedOption[];
		onChange: (value: string) => void;
		label: string;
		/** Fire onChange on the chosen option too: a bulk choice that re-applies (drops per-row overrides). */
		reselect?: boolean;
		class?: string;
	} = $props();

	function key(e: KeyboardEvent, i: number): void {
		const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		const n = options.length;
		for (let j = 1; j <= n; j++) {
			const next = options[(i + step * j + n * n) % n];
			if (!next.disabled) {
				onChange(next.value);
				const group = (e.currentTarget as HTMLElement).parentElement;
				(group?.querySelector(`[data-value="${CSS.escape(next.value)}"]`) as HTMLElement | null)?.focus();
				return;
			}
		}
	}
</script>

<div
	class={cn('bg-muted inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md p-0.5', className)}
	role="radiogroup"
	aria-label={label}
	data-slot="segmented"
>
	{#each options as o, i (o.value)}
		{@const on = o.value === value}
		<button
			type="button"
			role="radio"
			aria-checked={on}
			tabindex={on || (!value && i === 0) ? 0 : -1}
			disabled={o.disabled}
			title={o.title}
			data-value={o.value}
			data-state={on ? 'on' : 'off'}
			class={cn(
				'inline-flex h-6 items-center rounded-[calc(var(--radius-md)-2px)] border px-2 text-xs whitespace-nowrap transition-colors outline-none',
				'focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50',
				on
					? cn('bg-card border-foreground/25 text-foreground font-semibold shadow-sm', o.tone === 'destructive' && 'border-destructive/60 text-destructive')
					: 'text-muted-foreground hover:text-foreground border-transparent font-normal'
			)}
			onclick={() => (reselect || !on) && onChange(o.value)}
			onkeydown={(e) => key(e, i)}
		>
			{o.label}
		</button>
	{/each}
</div>
