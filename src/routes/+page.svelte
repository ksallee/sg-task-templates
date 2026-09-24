<!-- The app starts on Connect; there is nothing to show before a site is named. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	onMount(() => {
		void goto('/connect', { replaceState: true });
	});
</script>
