// The shell carries the head tags for its path (`$lib/pure/seo`): the app renders in the
// browser only, and a link preview never runs it.
import type { Handle } from '@sveltejs/kit';
import { headFor } from '$lib/pure/seo';

export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%seo.head%', headFor(event.url.pathname))
	});
