import { redirect } from '@sveltejs/kit';

// The app starts on Connect; there is nothing to show before a site is named.
export function load(): never {
	redirect(307, '/connect');
}
