import { describe, expect, it } from 'vitest';

// Guards the wire shape every fixture must keep (contracts/fixtures.md): the row envelope, links
// under `relationships` as `{data}`, a multi_entity as an array never null.
type Json = any;
const all = import.meta.glob<Json>('./*.json', { eager: true, import: 'default' });
const load = (name: string): Json => all[`./${name}`];

const MULTI = new Set(['upstream_tasks', 'downstream_tasks', 'task_assignees', 'projects']);

function checkRow(row: Record<string, unknown>) {
	expect(Object.keys(row).sort()).toEqual(['attributes', 'id', 'relationships', 'type']);
	for (const [key, rel] of Object.entries(row.relationships as Record<string, { data: unknown }>)) {
		expect(rel).toHaveProperty('data');
		if (MULTI.has(key)) expect(Array.isArray(rel.data)).toBe(true);
	}
}

const shots = Object.keys(all)
	.map((k) => k.slice(2))
	.filter((f) => !/templates|project|status|batch|revive/.test(f));

describe('fixtures', () => {
	it.each(shots)('%s is a shot snapshot of wire rows', (name: string) => {
		const f = load(name);
		checkRow(f.shot);
		f.tasks.forEach(checkRow);
		f.dependencies.forEach(checkRow);
		expect(typeof f.usage).toBe('object');
	});

	it.each(['recipe015-templates.json', 'S16-mismatch-templates.json'])('%s holds template rows', (name: string) => {
		const f = load(name);
		[...f.templates, ...f.templateTasks, ...f.templateDependencies].forEach(checkRow);
		for (const t of f.templateTasks) {
			expect(t.relationships.project.data).toBeNull();
			expect(t.relationships.task_template.data.type).toBe('TaskTemplate');
		}
	});

	it('every TaskDependency names its ends consistently', () => {
		for (const name of [...shots, 'recipe015-templates.json']) {
			const f = load(name);
			for (const d of f.dependencies ?? f.templateDependencies) {
				expect(d.relationships.task.data.id).toBe(d.attributes.task_id);
				expect(d.relationships.dependent_task.data.id).toBe(d.attributes.dependent_task_id);
			}
		}
	});
});
