<!--
	The app's mark and lockup, a sibling of sg-widgets' and sg-notes' (sg-widgets
	`docs/design-rules.md` rule 10): two tiles, the accent once on the back one, the quiet ink in
	front, lifted off by a gap in the colour of the surface under the mark. What makes it this
	app's is the front tile: a template, three task lines cut into it.
	`src/lib/assets/favicon.svg` is this drawing with the default palette's values pinned.
-->
<script lang="ts">
	let { title = 'SG Task Templates', size = '1.25em' }: { title?: string; size?: string } = $props();
	const head = $derived(title.split(' ')[0] ?? '');
	const tail = $derived(title.split(' ').slice(1).join(' '));
</script>

<span class="wordmark" translate="no">
	<svg class="mark" style="width:{size};height:{size}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
		<rect class="tile accent" x="2" y="2" width="22" height="22" />
		<rect class="tile front" x="13" y="13" width="25" height="25" />
		<rect class="line" x="18" y="19" width="15" height="2.4" rx="1.2" />
		<rect class="line" x="18" y="24.8" width="11" height="2.4" rx="1.2" />
		<rect class="line" x="18" y="30.6" width="13" height="2.4" rx="1.2" />
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
		--tile-radius: calc(var(--radius) * 0.5);
		--ground: var(--mark-ground, var(--background));
	}

	.tile {
		rx: var(--tile-radius);
		ry: var(--tile-radius);
	}

	.accent {
		fill: var(--primary);
	}

	/* The gap that lifts the front tile off the accent one: the stroke is drawn under the fill. */
	.front {
		fill: color-mix(in oklab, currentColor 30%, var(--ground));
		stroke: var(--ground);
		stroke-width: 2.2;
		paint-order: stroke;
	}

	.line {
		fill: var(--ground);
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
