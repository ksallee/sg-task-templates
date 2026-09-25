/**
 * The confirm dialog Apply opens on the plan: one line of totals; when Tasks are deleted, a notice
 * on top with what is deleted and orphaned (089) and each Task, and a destructive button naming the
 * deletes (the second confirmation, brief 3); then only what is risky (omits, hand-renamed Tasks
 * that get the template's name, fields overwritten from the template). Over the entities the run
 * writes (apply-view `writablePlans`). Pure, no I/O.
 */

import { writablePlans } from './apply-view';
import { fieldLabel } from './plan-summary';
import type { EntityPlan, FieldChange, FieldName, RunOptions } from './types';

export interface ConfirmLine {
	text: string;
	/** A delete that unlinks Versions or Published Files (089). */
	loud: boolean;
}

export interface ConfirmSection {
	title: string;
	lines: ConfirmLine[];
}

export interface ApplyConfirm {
	headline: string;
	/** Tasks the run deletes, shown first; null when none. */
	deletes: ConfirmSection | null;
	sections: ConfirmSection[];
	action: { label: string; destructive: boolean };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function applyConfirm(
	plans: EntityPlan[],
	opts: RunOptions,
	entityType: string | null,
	labels: Record<FieldName, string>
): ApplyConfirm {
	const writable = writablePlans(plans);
	let created = 0;
	let linked = 0;
	let omits = 0;
	const deletes: ConfirmLine[] = [];
	let orphanedVersions = 0;
	let orphanedFiles = 0;
	const renames: ConfirmLine[] = [];
	const overwrites = new Map<FieldName, number>();
	// The name is under renames: only a hand rename is risky.
	const countOverwrites = (changes: FieldChange[] | undefined) => {
		for (const c of changes ?? []) if (c.policy === 'overwrite' && c.field !== 'content') overwrites.set(c.field, (overwrites.get(c.field) ?? 0) + 1);
	};

	for (const p of writable) {
		const name = p.entity.name ?? `${p.entity.type} ${p.entity.id}`;
		for (const r of p.rows) {
			if (r.kind === 'create') created++;
			if (r.kind === 'claim') linked++;
			if (r.kind === 'keep' || r.kind === 'claim') {
				countOverwrites(r.fieldChanges);
				if (r.rename?.handRenamed) renames.push({ text: `${name} · ${r.rename.from ?? '(empty)'} to ${r.rename.to ?? '(empty)'}`, loud: false });
			}
			if (r.kind === 'extra') {
				countOverwrites(r.fieldChanges);
				if (r.action === 'omit') omits++;
				if (r.action === 'delete') {
					const { versions, publishedFiles } = r.usage;
					orphanedVersions += versions;
					orphanedFiles += publishedFiles;
					deletes.push({
						text: `${name} · ${r.task.content} #${r.task.id}: ${plural(versions, 'Version', 'Versions')}, ${plural(publishedFiles, 'Published File', 'Published Files')}`,
						loud: versions + publishedFiles > 0
					});
				}
			}
		}
	}

	const n = writable.length;
	const noun = entityType ? plural(n, entityType, `${entityType}s`) : plural(n, 'entity', 'entities');
	const totals = [created ? `${plural(created, 'Task', 'Tasks')} created` : '', linked ? `${linked} linked` : ''].filter(Boolean);
	const headline = `Apply to ${noun}${totals.length ? `: ${totals.join(', ')}` : ''}.`;

	const sections: ConfirmSection[] = [];
	if (omits) sections.push({ title: 'Omitted', lines: [{ text: `${plural(omits, 'Task', 'Tasks')} not in the template ${omits === 1 ? 'gets' : 'get'} status ${opts.omitStatus}.`, loud: false }] });
	if (renames.length) sections.push({ title: "Renamed by hand, gets the template's name", lines: renames });
	if (overwrites.size)
		sections.push({
			title: 'Overwritten from the template',
			lines: [...overwrites].map(([field, count]) => ({ text: `${fieldLabel(labels, field)} on ${plural(count, 'Task', 'Tasks')}`, loud: false }))
		});
	const deleted = plural(deletes.length, 'Task', 'Tasks');
	const orphaned =
		orphanedVersions + orphanedFiles > 0
			? ` ${plural(orphanedVersions, 'Version', 'Versions')} and ${plural(orphanedFiles, 'Published File', 'Published Files')} will be orphaned.`
			: '';
	return {
		headline,
		deletes: deletes.length ? { title: `${deleted} will be deleted.${orphaned}`, lines: [...deletes.filter((l) => l.loud), ...deletes.filter((l) => !l.loud)] } : null,
		sections,
		action: deletes.length ? { label: `Apply and delete ${deleted}`, destructive: true } : { label: 'Apply', destructive: false }
	};
}
