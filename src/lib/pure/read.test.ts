import { describe, expect, it } from 'vitest';
import type { EntityRef } from './types';
import { normalizeField, type EntityRow, type FieldSchema, type RawFieldSchema } from 'sg-widgets-core';
import {
	BASE_TASK_FIELDS,
	defaultTemplateFor,
	edgeFromRow,
	nonEmptyPolicyFields,
	taskFieldsFor,
	taskFromRow,
	taskStatusContext,
	templatableTypes,
	templateFromRows,
	templateTaskFromRow,
	usageFromRows
} from './read';
import templates from './fixtures/recipe015-templates.json';
import shotBefore from './fixtures/recipe015-shot-before.json';
import shotAfter from './fixtures/recipe015-shot-after.json';
import project from './fixtures/project.json';
import taskStatusField from './fixtures/task-status-field.json';

const tt2 = () =>
	templateFromRows(
		templates.templates[1] as EntityRow,
		templates.templateTasks.filter((t) => t.relationships.task_template.data?.id === 202) as EntityRow[],
		templates.templateDependencies as EntityRow[]
	);

describe('taskFromRow', () => {
	const templateOf = (id: number) => (id === 47102 || id === 47101 ? 201 : id >= 47201 ? 202 : null);

	it('reads links from relationships', () => {
		const row = shotBefore.tasks[1] as EntityRow; // 47296, linked to tt1 comp (47101)
		const task = taskFromRow(row, templateOf);
		expect(task.entity).toEqual({ id: 7557, name: 'sh010', type: 'Shot' });
		expect(task.step).toEqual({ id: 11, name: 'Animation', type: 'Step' });
		expect(task.templateTask).toEqual({ id: 47101, name: 'comp', templateId: 201 });
	});

	it('reads null content as null and key ""', () => {
		const row: EntityRow = {
			type: 'Task',
			id: 999,
			attributes: { content: null },
			relationships: { entity: { data: { id: 1, name: 'x', type: 'Shot' } } }
		};
		const task = taskFromRow(row, () => null);
		expect(task.content).toBeNull();
		expect(task.key).toContain('|');
		expect(task.key.endsWith('|')).toBe(true);
	});

	it('keeps a null template_task as no link', () => {
		const row = shotBefore.tasks[2] as EntityRow; // 47297, template_task null
		const task = taskFromRow(row, templateOf);
		expect(task.templateTask).toBeNull();
	});

	it('normalizes both created_at formats', () => {
		const zForm = taskFromRow(shotBefore.tasks[0] as EntityRow, () => null);
		expect(zForm.createdAt).toBe('2026-09-02T15:58:21Z');

		const row: EntityRow = {
			type: 'Task',
			id: 1,
			attributes: { content: 'x', created_at: '2026-09-02 19:07:26 UTC' },
			relationships: { entity: { data: { id: 1, name: 'x', type: 'Shot' } } }
		};
		expect(taskFromRow(row, () => null).createdAt).toBe('2026-09-02T19:07:26Z');
	});

	it('reads pinned and dependency_violation', () => {
		const row: EntityRow = {
			type: 'Task',
			id: 1,
			attributes: { content: 'x', pinned: true, dependency_violation: true },
			relationships: { entity: { data: { id: 1, name: 'x', type: 'Shot' } } }
		};
		const task = taskFromRow(row, () => null);
		expect(task.pinned).toBe(true);
		expect(task.dependencyViolation).toBe(true);
	});

	it('reads a multi_entity as [] never null when omitted', () => {
		const row: EntityRow = {
			type: 'Task',
			id: 1,
			attributes: { content: 'x' },
			relationships: { entity: { data: { id: 1, name: 'x', type: 'Shot' } } }
		};
		const task = taskFromRow(row, () => null);
		expect(task.assignees).toEqual([]);
		expect(task.reviewers).toEqual([]);
	});

	it('collects the policy fields, including custom ones, into .fields', () => {
		const row: EntityRow = {
			type: 'Task',
			id: 1,
			attributes: { content: 'x', sg_sort_order: 10, sg_priority_1: '1_Tier' },
			relationships: {
				entity: { data: { id: 1, name: 'x', type: 'Shot' } },
				step: { data: { id: 11, name: 'Animation', type: 'Step' } },
				task_reviewers: { data: [{ id: 5, name: 'G1', type: 'Group' }] }
			}
		};
		const task = taskFromRow(row, () => null);
		expect(task.fields.content).toBe('x');
		expect(task.fields.step).toBe(11);
		expect(task.fields.sg_sort_order).toBe(10);
		expect(task.fields.task_reviewers).toEqual([{ type: 'Group', id: 5 }]);
		expect(task.fields.sg_priority_1).toBe('1_Tier');
	});
});

describe('task_reviewers in .fields', () => {
	// task_reviewers holds Groups and people (102 wrote Groups G1, G2): ids alone collide across types.
	const row = (reviewers: EntityRef[]): EntityRow => ({
		type: 'Task',
		id: 1,
		attributes: { content: 'x' },
		relationships: { entity: { data: { id: 1, name: 'x', type: 'Shot' } }, task_reviewers: { data: reviewers } }
	});

	it('keeps the type next to the id, so a Group and a person of one id differ', () => {
		const group = taskFromRow(row([{ type: 'Group', id: 5, name: 'G1' }]), () => null);
		const person = taskFromRow(row([{ type: 'HumanUser', id: 5, name: 'P' }]), () => null);
		expect(group.fields.task_reviewers).not.toEqual(person.fields.task_reviewers);
	});

	it('is order-independent and drops the name', () => {
		const a = taskFromRow(row([{ type: 'HumanUser', id: 9, name: 'P' }, { type: 'Group', id: 5, name: 'G1' }]), () => null);
		const b = taskFromRow(row([{ type: 'Group', id: 5, name: 'renamed' }, { type: 'HumanUser', id: 9, name: 'P' }]), () => null);
		expect(a.fields.task_reviewers).toEqual(b.fields.task_reviewers);
	});
});

describe('templateTaskFromRow', () => {
	it('reads a template task: project null, entity null, task_template set', () => {
		const row = templates.templateTasks[0] as EntityRow; // 47101 comp, tt1
		const tt = templateTaskFromRow(row);
		expect(tt.templateId).toBe(201);
		expect(tt.content).toBe('comp');
		expect(tt.step).toEqual({ id: 11, name: 'Animation', type: 'Step' });
	});

	it('throws when the row has no task_template link', () => {
		const row: EntityRow = {
			type: 'Task',
			id: 1,
			attributes: { content: 'x' },
			relationships: { task_template: { data: null } }
		};
		expect(() => templateTaskFromRow(row)).toThrow();
	});
});

describe('edgeFromRow', () => {
	it('maps task to downstream and dependent_task to upstream', () => {
		const row = templates.templateDependencies[0] as EntityRow;
		const edge = edgeFromRow(row);
		expect(edge.downstream).toBe(47203);
		expect(edge.upstream).toBe(47201);
		expect(edge.type).toBe('start-to-start');
		expect(edge.offsetDays).toBe(1);
		expect(edge.id).toBe(9001);
	});

	it('reads omitted type as finish-to-start-next-day', () => {
		const row: EntityRow = {
			type: 'TaskDependency',
			id: 1,
			attributes: { task_id: 2, dependent_task_id: 3 },
			relationships: {}
		};
		expect(edgeFromRow(row).type).toBe('finish-to-start-next-day');
	});
});

describe('templateFromRows', () => {
	it('sorts tasks by sg_sort_order then id, nulls last', () => {
		const tpl = tt2();
		expect(tpl.tasks.map((t) => t.content)).toEqual(['comp', 'roto', 'paint']);
	});

	it('builds the template edges', () => {
		const tpl = tt2();
		expect(tpl.edges).toHaveLength(1);
		expect(tpl.edges[0]).toMatchObject({ downstream: 47203, upstream: 47201, type: 'start-to-start' });
	});

	it('places a null sort order after every set one', () => {
		const tpl = templateFromRows(
			templates.templates[0] as EntityRow,
			[
				{
					type: 'Task',
					id: 1,
					attributes: { content: 'b', sg_sort_order: null },
					relationships: { task_template: { data: { id: 201, name: 'tt1', type: 'TaskTemplate' } } }
				},
				{
					type: 'Task',
					id: 2,
					attributes: { content: 'a', sg_sort_order: 10 },
					relationships: { task_template: { data: { id: 201, name: 'tt1', type: 'TaskTemplate' } } }
				}
			],
			[]
		);
		expect(tpl.tasks.map((t) => t.id)).toEqual([2, 1]);
	});
});

describe('usageFromRows', () => {
	it('counts Versions by Version.sg_task and PublishedFiles by PublishedFile.task', () => {
		const versions: EntityRow[] = [
			{ type: 'Version', id: 1, attributes: {}, relationships: { sg_task: { data: { id: 47297, name: '', type: 'Task' } } } },
			{ type: 'Version', id: 2, attributes: {}, relationships: { sg_task: { data: { id: 47297, name: '', type: 'Task' } } } },
			{ type: 'Version', id: 3, attributes: {}, relationships: { sg_task: { data: null } } }
		];
		const files: EntityRow[] = [
			{ type: 'PublishedFile', id: 1, attributes: {}, relationships: { task: { data: { id: 47297, name: '', type: 'Task' } } } }
		];
		expect(usageFromRows(versions, files)).toEqual({ 47297: { versions: 2, publishedFiles: 1 } });
	});

	it('gives an empty map for no rows', () => {
		expect(usageFromRows([], [])).toEqual({});
	});
});

describe('defaultTemplateFor', () => {
	it('returns null for an absent tracking_settings', () => {
		expect(defaultTemplateFor(undefined, 'Shot')).toBeNull();
		expect(defaultTemplateFor(null, 'Shot')).toBeNull();
	});

	it('returns null for an empty default_task_template', () => {
		expect(defaultTemplateFor({ default_task_template: {} }, 'Shot')).toBeNull();
	});

	it('returns null for a missing type key', () => {
		expect(defaultTemplateFor(project.attributes.tracking_settings, 'Asset')).toBeNull();
	});

	it('returns null for an entry without a numeric id', () => {
		expect(defaultTemplateFor({ default_task_template: { Shot: {} } }, 'Shot')).toBeNull();
		expect(defaultTemplateFor({ default_task_template: { Shot: { type: 'TaskTemplate', id: '202' } } }, 'Shot')).toBeNull();
	});

	it('returns the ref for a set type', () => {
		expect(defaultTemplateFor(project.attributes.tracking_settings, 'Shot')).toEqual({
			type: 'TaskTemplate',
			id: 202,
			name: 'tt2'
		});
	});
});

describe('templatableTypes', () => {
	it('includes a type with a task_template field, custom entities included', () => {
		const fieldsByType = {
			Shot: { task_template: {} as FieldSchema, code: {} as FieldSchema },
			CustomEntity01: { task_template: {} as FieldSchema },
			Note: { subject: {} as FieldSchema }
		};
		expect(templatableTypes(fieldsByType)).toEqual(['Shot', 'CustomEntity01']);
	});

	it('leaves out Task: its task_template marks template tasks (TaskTemplate card)', () => {
		const fieldsByType = {
			Task: { task_template: {} as FieldSchema, template_task: {} as FieldSchema },
			Shot: { task_template: {} as FieldSchema }
		};
		expect(templatableTypes(fieldsByType)).toEqual(['Shot']);
	});

	it('is empty when nothing has the field', () => {
		expect(templatableTypes({ Note: { subject: {} as FieldSchema } })).toEqual([]);
	});
});

describe('taskStatusContext', () => {
	it('subtracts hidden_values from valid_values', () => {
		// The fixture holds the wire `properties` (contracts/fixtures.md); the client normalizes them.
		const envelope = (value: unknown) => ({ value, editable: false });
		const raw = {
			name: envelope('Status'),
			entity_type: envelope('Task'),
			data_type: envelope('status_list'),
			editable: envelope(true),
			mandatory: envelope(false),
			unique: envelope(false),
			properties: taskStatusField.properties
		} as unknown as RawFieldSchema;
		const ctx = taskStatusContext(normalizeField('sg_status_list', raw));
		expect(ctx.defaultTaskStatus).toBe('wtg');
		expect(ctx.validTaskStatuses).not.toContain('dis');
		expect(ctx.validTaskStatuses).toContain('wtg');
		expect(ctx.validTaskStatuses).toHaveLength(9);
	});
});

describe('nonEmptyPolicyFields / taskFieldsFor', () => {
	it('lists the non-empty fields across a template’s tasks', () => {
		const tpl = tt2();
		// Every tt2 task holds content, step and sg_sort_order; the rest are null, false or [].
		expect(nonEmptyPolicyFields(tpl)).toEqual(['content', 'sg_sort_order', 'step']);
	});

	it('never lists a field whose only value is false or empty', () => {
		const tpl = templateFromRows(
			templates.templates[0] as EntityRow,
			[
				{
					type: 'Task',
					id: 1,
					attributes: { content: 'a', milestone: false, sg_description: '', est_in_mins: 0 },
					relationships: { task_template: { data: { id: 201, name: 'tt1', type: 'TaskTemplate' } } }
				}
			],
			[]
		);
		expect(nonEmptyPolicyFields(tpl)).not.toContain('milestone');
		expect(nonEmptyPolicyFields(tpl)).not.toContain('sg_description');
		expect(nonEmptyPolicyFields(tpl)).toContain('est_in_mins'); // 108: 0 overwrites
	});

	it('adds a non-empty custom field to the policy list', () => {
		const tpl = templateFromRows(
			templates.templates[0] as EntityRow,
			[
				{
					type: 'Task',
					id: 1,
					attributes: { content: 'a', sg_priority_1: '1_Tier' },
					relationships: { task_template: { data: { id: 201, name: 'tt1', type: 'TaskTemplate' } } }
				}
			],
			[]
		);
		expect(nonEmptyPolicyFields(tpl)).toContain('sg_priority_1');
	});

	it('requests the base fields plus custom policy fields, deduplicated', () => {
		const tpl = templateFromRows(
			templates.templates[0] as EntityRow,
			[
				{
					type: 'Task',
					id: 1,
					attributes: { content: 'a', sg_priority_1: '1_Tier' },
					relationships: { task_template: { data: { id: 201, name: 'tt1', type: 'TaskTemplate' } } }
				}
			],
			[]
		);
		const fields = taskFieldsFor(tpl);
		expect(new Set(fields).size).toBe(fields.length);
		for (const f of BASE_TASK_FIELDS) expect(fields).toContain(f);
		expect(fields).toContain('sg_priority_1');
	});
});

describe('recipe 015 fixture: shot-before through read.ts', () => {
	it('reads the three Tasks with their links intact', () => {
		const templateOf = (id: number) => (id === 47101 || id === 47102 ? 201 : null);
		const tasks = (shotBefore.tasks as EntityRow[]).map((r) => taskFromRow(r, templateOf));
		expect(tasks.map((t) => t.content)).toEqual(['roto', 'comp', 'paint']);
		expect(tasks[0].templateTask).toEqual({ id: 47102, name: 'roto', templateId: 201 });
		expect(tasks[2].templateTask).toBeNull();
	});

	it('reads the after snapshot with the new Task and its edge', () => {
		const templateOf = (id: number) => (id >= 47201 && id <= 47203 ? 202 : id === 47102 ? 201 : null);
		const tasks = (shotAfter.tasks as EntityRow[]).map((r) => taskFromRow(r, templateOf));
		const created = tasks.find((t) => t.id === 47298)!;
		expect(created.templateTask).toEqual({ id: 47202, name: 'roto', templateId: 202 });
		const edges = (shotAfter.dependencies as EntityRow[]).map(edgeFromRow);
		expect(edges).toEqual([{ id: 9101, downstream: 47297, upstream: 47296, type: 'start-to-start', offsetDays: 1 }]);
	});
});
