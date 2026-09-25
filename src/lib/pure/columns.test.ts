import { describe, expect, it } from 'vitest';
import { columnsKeyFor, defaultColumns, taskCount } from './columns';

/** A schema's field names, the way `schema.fields(type)` keys them. */
const fields = (...names: string[]): Record<string, unknown> => Object.fromEntries(names.map((name) => [name, {}]));

const COMMON = ['image', 'code', 'description', 'sg_status_list', 'task_template', 'tasks'];

describe('defaultColumns', () => {
	it('puts the thumbnail first, then code, description, status, template, the type\'s own and the Task count', () => {
		const shot = defaultColumns('Shot', fields(...COMMON, 'sg_sequence', 'sg_cut_in'));
		expect(shot.map((c) => c.path)).toEqual(['image', 'code', 'description', 'sg_status_list', 'task_template', 'sg_sequence', 'tasks']);
		const asset = defaultColumns('Asset', fields(...COMMON, 'sg_asset_type', 'sg_sequence'));
		expect(asset.map((c) => c.path)).toEqual(['image', 'code', 'description', 'sg_status_list', 'task_template', 'sg_asset_type', 'tasks']);
	});

	it('skips a field the type lacks', () => {
		const out = defaultColumns('Sequence', fields('code', 'sg_status_list', 'task_template'));
		expect(out.map((c) => c.path)).toEqual(['code', 'sg_status_list', 'task_template']);
		expect(defaultColumns('Shot', fields('code', 'image')).map((c) => c.path)).toEqual(['image', 'code']);
	});

	it('names the Task count and right-aligns it', () => {
		const tasks = defaultColumns('Shot', fields('code', 'tasks')).find((c) => c.path === 'tasks');
		expect(tasks).toMatchObject({ header: 'Tasks', align: 'right', sortable: false, editable: false });
	});

	it('keeps the thumbnail narrow and unsorted, and nothing editable', () => {
		const out = defaultColumns('Shot', fields(...COMMON, 'sg_sequence'));
		expect(out.find((c) => c.path === 'image')).toMatchObject({ width: 100, sortable: false });
		expect(out.every((c) => c.editable === false)).toBe(true);
	});
});

describe('taskCount', () => {
	it('counts the links a tasks field holds', () => {
		expect(taskCount([{ type: 'Task', id: 1 }, { type: 'Task', id: 2 }])).toBe(2);
		expect(taskCount([])).toBe(0);
	});

	it('says nothing for a value that is not a list', () => {
		expect(taskCount(null)).toBeNull();
		expect(taskCount(undefined)).toBeNull();
		expect(taskCount('x')).toBeNull();
	});
});

describe('columnsKeyFor', () => {
	it('keys the choice by project and type', () => {
		expect(columnsKeyFor(70, 'Shot')).toBe('sg-task-templates:columns:70:Shot');
		expect(columnsKeyFor(70, 'Asset')).not.toBe(columnsKeyFor(71, 'Asset'));
	});
});
