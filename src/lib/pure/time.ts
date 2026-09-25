/** Times as the screens print them: the browser's local time, to the minute. Pure, no I/O. */

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-09-25 16:45` for an ISO instant, in the local time zone. Anything unparsable comes back as is. */
export function localTime(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
