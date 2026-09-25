/**
 * sg-widgets-core's `repeatedLabels` (sg-widgets #349), not in 0.3.0 yet. The registry copies of
 * field-picker and column-picker import it from here until the next sg-widgets-core release; then
 * the import goes back to 'sg-widgets-core' and this file goes.
 *
 * The labels more than one entry carries, as given, so a list can show what tells them apart.
 * Case and outer spaces do not count as a difference.
 */
export function repeatedLabels(labels: readonly string[]): Set<string> {
	const counts = new Map<string, number>();
	const key = (label: string): string => label.trim().toLowerCase();
	for (const label of labels) counts.set(key(label), (counts.get(key(label)) ?? 0) + 1);
	return new Set(labels.filter((label) => (counts.get(key(label)) ?? 0) > 1));
}
