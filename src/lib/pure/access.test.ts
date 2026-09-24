import { describe, expect, it } from 'vitest';
import {
	ACCESS_CREATE_CONTENT,
	ACCESS_DELETE_SENTINEL_ID,
	ACCESS_INVALID_STATUS,
	buildAccessProbeRequests,
	buildAccessWarning,
	classifyAccessResponse,
	schemaFieldAccess,
	summarizeAccess
} from './access';
import { matchKey } from './matching';
import type {
	AccessCheck,
	AccessResponse,
	EntitySnapshot,
	EntityRef,
	EntityTask
} from './types';
import type { FieldSchema } from 'sg-widgets-core';

const project: EntityRef = { type: 'Project', id: 1180, name: 'sandbox' };

const entity: EntitySnapshot['entity'] = {
	type: 'Shot',
	id: 7557,
	name: 'sh010',
	entityType: 'Shot',
	taskTemplate: { type: 'TaskTemplate', id: 201, name: 'tt1' }
};

const task: EntityTask = {
	id: 47295,
	content: 'roto',
	step: { type: 'Step', id: 13, name: 'Comp' },
	key: matchKey('roto', 13),
	status: 'wtg',
	sortOrder: 20,
	duration: null,
	estInMins: null,
	description: null,
	milestone: false,
	startDate: null,
	dueDate: null,
	assignees: [],
	reviewers: [],
	fields: { duration: 60, sg_description: 'a Task', sg_sort_order: 20, milestone: false, est_in_mins: null },
	entity: { type: 'Shot', id: 7557, name: 'sh010' },
	templateTask: null,
	pinned: false,
	dependencyViolation: false,
	createdAt: '2026-09-02T15:58:21Z'
};

describe('buildAccessProbeRequests', () => {
	const reqs = buildAccessProbeRequests({
		task,
		entity,
		entityCode: 'sh010',
		project,
		fields: ['duration', 'sg_description']
	});

	it('no-op PUTs only the given fields, at their current values, as a plain PUT (017 can_update)', () => {
		expect(reqs.updateTask).toEqual({
			method: 'PUT',
			entity: 'Task',
			record_id: 47295,
			body: { duration: 60, sg_description: 'a Task' }
		});
	});

	it('sends no update probe for no fields: an empty PUT answers 200 for everyone (094 candidate 5)', () => {
		const none = buildAccessProbeRequests({ task, entity, entityCode: 'sh010', project, fields: [] });
		expect(none.updateTask).toBeNull();
	});

	it('no-op PUTs the entity its own current code, the field 094 measured (candidate 4), as a plain PUT', () => {
		expect(reqs.updateEntity).toEqual({
			method: 'PUT',
			entity: 'Shot',
			record_id: 7557,
			body: { code: 'sh010' }
		});
	});

	it('posts a create with an invalid status as a plain POST, never a batch create (017)', () => {
		expect(reqs.createTask).toEqual({
			method: 'POST',
			entity: 'Task',
			body: {
				project: { type: 'Project', id: 1180 },
				entity: { type: 'Shot', id: 7557 },
				content: 'permission check',
				sg_status_list: 'zz_not_a_status'
			}
		});
	});

	it('batches the delete with a sentinel update that rolls it back', () => {
		expect(reqs.deleteTask).toEqual([
			{ request_type: 'delete', entity: 'Task', record_id: 47295 },
			{
				request_type: 'update',
				entity: 'Task',
				record_id: 999999999,
				data: { content: 'x' }
			}
		]);
	});

	it('never emits a real delete without the sentinel alongside it', () => {
		expect(reqs.deleteTask).toHaveLength(2);
		const sentinel = reqs.deleteTask[1];
		if (sentinel.request_type !== 'update') throw new Error('expected the sentinel update');
		expect(sentinel.record_id).not.toBe(task.id);
	});
});

describe('classifyAccessResponse: update_task and update_entity', () => {
	it('is allowed on 200', () => {
		const r: AccessResponse = { status: 200, title: null };
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('allowed');
		expect(classifyAccessResponse('update_entity', r, 'Shot')).toBe('allowed');
	});

	it('is refused on the exact "field is not editable" title', () => {
		const r: AccessResponse = {
			status: 400,
			title: 'The field is not editable for this user: [Task.content].'
		};
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('refused');
	});

	it('reads the entity type into the refusal, for a field the app never tested by name', () => {
		const r: AccessResponse = {
			status: 400,
			title: 'The field is not editable for this user: [Shot.task_template].'
		};
		expect(classifyAccessResponse('update_entity', r, 'Shot')).toBe('refused');
	});

	it('is refused on a conditional rule, whose 400 continues after the field with the rule (094 row 3)', () => {
		// 094 row 3 records this 400 as "... [Task.sg_status_list]. Rule: Artist -- PermissionRule 2615: ...",
		// its "..." standing for row 2's prefix. The prefix and the continuation are verbatim from 094;
		// the rest of the rule text 094 elides.
		const r: AccessResponse = {
			status: 400,
			title:
				'The field is not editable for this user: ' +
				'[Task.sg_status_list]. Rule: Artist -- PermissionRule 2615: update_field_condition ... RULE: ' +
				'{"logical_operator":"and","conditions": [... task_assignees is logged_in_user_token, task_reviewers is ...]}'
		};
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('refused');
	});

	it('is unknown on an unrecognized 400', () => {
		const r: AccessResponse = { status: 400, title: 'Something else entirely.' };
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('unknown');
	});

	it('is unknown when there is no response at all', () => {
		expect(classifyAccessResponse('update_task', null, 'Task')).toBe('unknown');
	});
});

describe('classifyAccessResponse: create_task', () => {
	it('is allowed when the refusal is the deliberately-invalid status', () => {
		const r: AccessResponse = {
			status: 400,
			title:
				"Invalid field value, update failed [5 - Status 'zz_not_a_status' is not a valid status. Valid statuses: 'wtg', 'ip', 'fin']"
		};
		expect(classifyAccessResponse('create_task', r, 'Task')).toBe('allowed');
	});

	it('is refused on the exact "cannot be created" title', () => {
		const r: AccessResponse = { status: 400, title: 'Entity of type Task cannot be created by this user.' };
		expect(classifyAccessResponse('create_task', r, 'Task')).toBe('refused');
	});

	it('is unknown on anything else', () => {
		const r: AccessResponse = { status: 500, title: null };
		expect(classifyAccessResponse('create_task', r, 'Task')).toBe('unknown');
	});
});

describe('classifyAccessResponse: delete_task', () => {
	it('is allowed when the batch rolls back on the sentinel', () => {
		const r: AccessResponse = {
			status: 404,
			title: `Entity of type [Task] with id=${ACCESS_DELETE_SENTINEL_ID} does not exist.`
		};
		expect(classifyAccessResponse('delete_task', r, 'Task')).toBe('allowed');
	});

	it('is refused on the exact "can not be deleted" title', () => {
		const r: AccessResponse = { status: 400, title: 'Entity of type Task can not be deleted by this user.' };
		expect(classifyAccessResponse('delete_task', r, 'Task')).toBe('refused');
	});

	it('does not confuse the generic 404 reason phrase with the sentinel detail', () => {
		const r: AccessResponse = { status: 404, title: 'Not Found' };
		expect(classifyAccessResponse('delete_task', r, 'Task')).toBe('unknown');
	});
});

describe('schemaFieldAccess', () => {
	const field = (editable: boolean): FieldSchema =>
		({ name: 'x', displayName: 'X', entityType: 'Task', dataType: 'text', editable, mandatory: false, unique: false }) as FieldSchema;

	it('maps editable false to refused and true to maybe', () => {
		expect(
			schemaFieldAccess({
				content: field(false),
				sg_status_list: field(true)
			})
		).toEqual({ content: 'refused', sg_status_list: 'maybe' });
	});
});

describe('summarizeAccess', () => {
	const allowed: AccessCheck = { capability: 'update_task', result: 'allowed', response: { status: 200, title: null } };
	const refused: AccessCheck = {
		capability: 'delete_task',
		result: 'refused',
		response: { status: 400, title: 'Entity of type Task can not be deleted by this user.' }
	};
	const unknown: AccessCheck = { capability: 'create_task', result: 'unknown', response: null };

	it('looks short when a capability is refused', () => {
		expect(summarizeAccess([allowed, refused], {}).looksShort).toBe(true);
	});

	it('looks short when a field the plan needs is refused in the schema', () => {
		expect(summarizeAccess([allowed], { content: 'refused' }).looksShort).toBe(true);
	});

	it('does not look short on allowed and maybe alone', () => {
		expect(summarizeAccess([allowed], { content: 'maybe' }).looksShort).toBe(false);
	});

	it('does not treat unknown as short: an unclear response is left unknown, not assumed refused', () => {
		expect(summarizeAccess([allowed, unknown], {}).looksShort).toBe(false);
	});
});

describe('buildAccessWarning', () => {
	it('returns null when nothing looks short', () => {
		const summary = summarizeAccess(
			[{ capability: 'update_task', result: 'allowed', response: { status: 200, title: null } }],
			{ content: 'maybe' }
		);
		expect(buildAccessWarning(summary)).toBeNull();
	});

	it('carries the checks, the fields and the sudo_as caveat when something looks short', () => {
		const refused: AccessCheck = {
			capability: 'delete_task',
			result: 'refused',
			response: { status: 400, title: 'Entity of type Task can not be deleted by this user.' }
		};
		const summary = summarizeAccess([refused], { sg_status_list: 'refused' });
		const warning = buildAccessWarning(summary);
		expect(warning?.code).toBe('access_short');
		if (warning?.code !== 'access_short') throw new Error('expected access_short');
		expect(warning.checks).toEqual([refused]);
		expect(warning.fields).toEqual({ sg_status_list: 'refused' });
		expect(warning.detail).toMatch(/sudo_as/);
		expect(warning.detail).toMatch(/delete/i);
	});
});
