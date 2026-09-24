import { describe, expect, it } from 'vitest';
import {
	accessResponseFrom,
	buildAccessProbeRequests,
	buildAccessWarning,
	classifyAccessResponse,
	runFieldAccess,
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

	it('sends step as a Step link, not the bare id read.ts keeps (field_types/entity: a bare int is a 400)', () => {
		const withStep = buildAccessProbeRequests({
			task: { ...task, fields: { ...task.fields, step: 13 } },
			entity,
			entityCode: 'sh010',
			project,
			fields: ['step', 'duration']
		});
		expect(withStep.updateTask?.body).toEqual({ step: { type: 'Step', id: 13 }, duration: 60 });
		const noStep = buildAccessProbeRequests({
			task: { ...task, step: null, fields: { ...task.fields, step: null } },
			entity,
			entityCode: 'sh010',
			project,
			fields: ['step']
		});
		expect(noStep.updateTask?.body).toEqual({ step: null });
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

// Every string below is copied from 094 or 017. Where the corpus elides text with "...", the test
// keeps the "..." as recorded. `detail` is null wherever the corpus records none.

describe('classifyAccessResponse: update_task and update_entity', () => {
	it('is allowed on 200, which has no error body (017 first_error: None)', () => {
		const r: AccessResponse = { status: 200, title: null, detail: null };
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('allowed');
		expect(classifyAccessResponse('update_entity', r, 'Shot')).toBe('allowed');
	});

	it('is refused on the exact "field is not editable" title (017 can_update tasks content)', () => {
		const r: AccessResponse = {
			status: 400,
			title: 'The field is not editable for this user: [Task.content].',
			detail: null
		};
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('refused');
	});

	it('reads the entity type into the refusal (017 can_update shots code)', () => {
		const r: AccessResponse = {
			status: 400,
			title: 'The field is not editable for this user: [Shot.code].',
			detail: null
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
				'{"logical_operator":"and","conditions": [... task_assignees is logged_in_user_token, task_reviewers is ...]}',
			detail: null
		};
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('refused');
	});

	it('is unknown on a 400 that tests nothing (094 candidate 7)', () => {
		const r: AccessResponse = {
			status: 400,
			title: "API create() Task.zz_no_such_field doesn't exist.",
			detail: null
		};
		expect(classifyAccessResponse('update_task', r, 'Task')).toBe('unknown');
	});

	it('is unknown when there is no response at all', () => {
		expect(classifyAccessResponse('update_task', null, 'Task')).toBe('unknown');
	});
});

describe('classifyAccessResponse: create_task', () => {
	it('is allowed when the title names the deliberately-invalid status (017 can_create_task)', () => {
		const r: AccessResponse = {
			status: 400,
			title:
				"Invalid field value, update failed [5 - ... 'zz_not_a_status' is not a valid status. Valid statuses: 'wtg', 'ip', ...]",
			detail: null
		};
		expect(classifyAccessResponse('create_task', r, 'Task')).toBe('allowed');
	});

	it('is refused on the exact "cannot be created" title', () => {
		const r: AccessResponse = {
			status: 400,
			title: 'Entity of type Task cannot be created by this user.',
			detail: null
		};
		expect(classifyAccessResponse('create_task', r, 'Task')).toBe('refused');
	});

	it('is unknown on a 400 that tests nothing (094 candidate 7)', () => {
		const r: AccessResponse = {
			status: 400,
			title: "API create() Task.zz_no_such_field doesn't exist.",
			detail: null
		};
		expect(classifyAccessResponse('create_task', r, 'Task')).toBe('unknown');
	});
});

describe('classifyAccessResponse: delete_task', () => {
	// 017 reads the sentinel from `detail` (substring "id=999999999 does not exist") and the refusal
	// from `title`. The detail text is 094 row 8's message for a missing Task id; 017 records the
	// rolled-back batch's title as "Not Found".
	it('is allowed when detail names the sentinel, title "Not Found" (017 can_delete)', () => {
		const r: AccessResponse = {
			status: 404,
			title: 'Not Found',
			detail: 'Entity of type [Task] with id=999999999 does not exist.'
		};
		expect(classifyAccessResponse('delete_task', r, 'Task')).toBe('allowed');
	});

	it('is refused on the exact "can not be deleted" title', () => {
		const r: AccessResponse = {
			status: 400,
			title: 'Entity of type Task can not be deleted by this user.',
			detail: null
		};
		expect(classifyAccessResponse('delete_task', r, 'Task')).toBe('refused');
	});

	it('is unknown on "Not Found" with no sentinel detail', () => {
		const r: AccessResponse = { status: 404, title: 'Not Found', detail: null };
		expect(classifyAccessResponse('delete_task', r, 'Task')).toBe('unknown');
	});

	it('reads the sentinel from detail only, never from title', () => {
		const r: AccessResponse = {
			status: 404,
			title: 'Entity of type [Task] with id=999999999 does not exist.',
			detail: null
		};
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
	const allowed: AccessCheck = { capability: 'update_task', result: 'allowed', response: { status: 200, title: null, detail: null } };
	const refused: AccessCheck = {
		capability: 'delete_task',
		result: 'refused',
		response: { status: 400, title: 'Entity of type Task can not be deleted by this user.', detail: null }
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
			[{ capability: 'update_task', result: 'allowed', response: { status: 200, title: null, detail: null } }],
			{ content: 'maybe' }
		);
		expect(buildAccessWarning(summary)).toBeNull();
	});

	it('carries the checks, the fields and the caveat that the check is partial', () => {
		const refused: AccessCheck = {
			capability: 'delete_task',
			result: 'refused',
			response: { status: 400, title: 'Entity of type Task can not be deleted by this user.', detail: null }
		};
		const summary = summarizeAccess([refused], { sg_status_list: 'refused' });
		const warning = buildAccessWarning(summary);
		expect(warning?.code).toBe('access_short');
		if (warning?.code !== 'access_short') throw new Error('expected access_short');
		expect(warning.checks).toEqual([refused]);
		expect(warning.fields).toEqual({ sg_status_list: 'refused' });
		expect(warning.detail).toMatch(/The check is partial/);
		expect(warning.detail).toMatch(/delete/i);
	});
});

describe('runFieldAccess', () => {
	const f = (name: string, editable: boolean, entityType = 'Task'): FieldSchema => ({
		name,
		displayName: name,
		entityType,
		dataType: 'text',
		editable,
		mandatory: false,
		unique: false
	});
	const taskSchema = {
		content: f('content', true),
		sg_description: f('sg_description', false),
		time_logs_sum: f('time_logs_sum', false)
	};

	it('keeps only the fields the run writes, plus the entity task_template by type', () => {
		expect(runFieldAccess(taskSchema, ['content', 'sg_description'], 'Shot', f('task_template', true, 'Shot'))).toEqual({
			content: 'maybe',
			sg_description: 'refused',
			'Shot.task_template': 'maybe'
		});
	});

	it('skips a field the schema does not name, and a missing entity field', () => {
		expect(runFieldAccess(taskSchema, ['sg_gone'], 'Shot', null)).toEqual({});
	});
});

describe('accessResponseFrom', () => {
	it('takes the first error title and detail', () => {
		const body = { errors: [{ status: 404, title: 'Not Found', detail: 'id=999999999 does not exist' }] };
		expect(accessResponseFrom(404, body)).toEqual({ status: 404, title: 'Not Found', detail: 'id=999999999 does not exist' });
	});

	it('reads a body without errors as nulls', () => {
		expect(accessResponseFrom(200, null)).toEqual({ status: 200, title: null, detail: null });
		expect(accessResponseFrom(500, 'oops')).toEqual({ status: 500, title: null, detail: null });
	});
});
