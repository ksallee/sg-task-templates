<!--
	The app's mark and lockup, a sibling of sg-widgets' and sg-notes' (sg-widgets
	`docs/design-rules.md` rule 10) in its type and its two inks: the accent once, the quiet ink
	for the rest. The mark is its own: a rubber stamp over its imprint, one template pressed onto
	many entities. The imprint is the accent; the stamp is `currentColor` at 30% over the ground.
	`src/lib/assets/favicon.svg` is this drawing with the default palette's values pinned.
-->
<script lang="ts">
	let { title = 'SG Task Templates', size = '1.25em' }: { title?: string; size?: string } = $props();
	const head = $derived(title.split(' ')[0] ?? '');
	const tail = $derived(title.split(' ').slice(1).join(' '));
</script>

<span class="wordmark" translate="no">
	<svg class="mark" style="width:{size};height:{size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
		<circle class="quiet" cx="16" cy="6.5" r="4.5" />
		<path class="quiet" d="M13.2 10.5h5.6l1.4 5h-8.4z" />
		<rect class="quiet" x="4" y="15.5" width="24" height="7" rx="2" />
		<rect class="accent" x="5" y="25" width="22" height="4.5" rx="1.5" />
	</svg>
	<span class="type"><span class="head">{head}</span> <span class="tail">{tail}</span></span>
</span>

<style>
	.wordmark {
		display: inline-flex;
		align-items: center;
		gap: 0.45em;
		font-size: 1rem;
		line-height: 1.1;
		letter-spacing: -0.01em;
		white-space: nowrap;
		min-width: 0;
	}

	.mark {
		display: block;
		flex: none;
		--ground: var(--mark-ground, var(--background));
	}

	.accent {
		fill: var(--primary);
	}

	.quiet {
		fill: color-mix(in oklab, currentColor 30%, var(--ground));
	}

	.type {
		overflow: hidden;
	}

	.head {
		font-weight: 600;
	}

	.tail {
		font-weight: 400;
		color: var(--muted-foreground);
	}
</style>
