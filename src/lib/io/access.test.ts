import { describe, expect, it } from 'vitest';
import { SgApiError, type BatchRequest, type EntityRow, type FieldSchema } from 'sg-widgets-core';
import { MockClient } from 'sg-widgets-core/mock';
import { checkAccess } from './access';
import { fakeClient, type Handlers } from './fake-client';
import { taskFromRow } from '$lib/pure/read';
import { ACCESS_DELETE_SENTINEL_ID } from '$lib/pure/access';
import shotBefore from '$lib/pure/fixtures/recipe015-shot-before.json';
import type { EntitySnapshot } from '$lib/pure/types';

const task = taskFromRow(shotBefore.tasks[0] as EntityRow, () => 201);
const entity: EntitySnapshot['entity'] = {
	type: 'Shot',
	id: 7557,
	name: 'sh010',
	entityType: 'Shot',
	taskTemplate: null
};
const project = { type: 'Project', id: 1180 };

const schema = (name: string, editable: boolean, entityType = 'Task'): FieldSchema => ({
	name,
	displayName: name,
	entityType,
	dataType: 'text',
	editable,
	mandatory: false,
	unique: false
});

const refuse = (status: number, title: string, detail?: string) =>
	new SgApiError(status, { errors: [{ status, title, ...(detail ? { detail } : {}) }] }, title);

/** Reads every probe needs: the sample Shot's code, the sentinel absent, and the schema. */
const reads = (editable: boolean, sentinel: EntityRow[] = []): Handlers => ({
	fields: async () => ({ content: schema('content', editable), time_logs_sum: schema('time_logs_sum', false) }),
	fieldWithProject: async (type, name) => schema(name, true, type),
	search: async (type) => ({
		data: type === 'Shot' ? [shotBefore.shot as EntityRow] : sentinel,
		hasMore: false
	})
});

describe('checkAccess', () => {
	it('reads an Admin as allowed everywhere, with the answers 017 records', async () => {
		const { client, calls } = fakeClient({
			...reads(true),
			update: async () => ({}),
			create: async () => {
				throw refuse(400, "Invalid field value, update failed [5 - 'zz_not_a_status' is not a valid status. Valid statuses: 'wtg']");
			},
			batch: async () => {
				throw refuse(404, 'Not Found', `Entity of type [Task] with id=${ACCESS_DELETE_SENTINEL_ID} does not exist.`);
			}
		});
		const summary = await checkAccess(client, { task, entity, project, fields: ['content'] });
		expect(summary.checks.map((c) => [c.capability, c.result])).toEqual([
			['update_task', 'allowed'],
			['update_entity', 'allowed'],
			['create_task', 'allowed'],
			['delete_task', 'allowed']
		]);
		expect(summary.fields).toEqual({ content: 'maybe', 'Shot.task_template': 'maybe' });
		expect(summary.looksShort).toBe(false);

		// The no-op PUTs carry the current values; the delete is 017's rolled-back pair.
		const byMethod = (m: string) => calls.filter((c) => c.method === m).map((c) => c.args);
		expect(byMethod('update')).toEqual([
			['Task', 47295, { content: 'roto' }],
			['Shot', 7557, { code: 'sh010' }]
		]);
		expect(byMethod('fields')).toEqual([['Task', 1180]]);
		const [batch] = byMethod('batch')[0] as [BatchRequest[]];
		expect(batch.map((r) => r.request_type)).toEqual(['delete', 'update']);
	});

	it('reads an Artist as short, with the refusals 017 records', async () => {
		const { client } = fakeClient({
			...reads(false),
			update: async (type) => {
				throw refuse(400, `The field is not editable for this user: [${type}.${type === 'Task' ? 'content' : 'code'}].`);
			},
			create: async () => {
				throw refuse(400, 'Entity of type Task cannot be created by this user.');
			},
			batch: async () => {
				throw refuse(400, 'Entity of type Task can not be deleted by this user.');
			}
		});
		const summary = await checkAccess(client, { task, entity, project, fields: ['content'] });
		expect(summary.checks.every((c) => c.result === 'refused')).toBe(true);
		expect(summary.fields.content).toBe('refused');
		expect(summary.looksShort).toBe(true);
	});

	it('skips the delete check when the sentinel id exists', async () => {
		const sentinel = [{ type: 'Task', id: ACCESS_DELETE_SENTINEL_ID, attributes: {}, relationships: {} }];
		const { client, calls } = fakeClient({ ...reads(true, sentinel), update: async () => ({}), create: async () => ({}) });
		const summary = await checkAccess(client, { task, entity, project, fields: ['content'] });
		expect(calls.some((c) => c.method === 'batch')).toBe(false);
		expect(summary.checks.find((c) => c.capability === 'delete_task')).toEqual({
			capability: 'delete_task',
			result: 'unknown',
			response: null
		});
	});

	it('sends no Task PUT without fields: an empty PUT tests nothing (094)', async () => {
		const { client, calls } = fakeClient({ ...reads(true), update: async () => ({}), create: async () => ({}), batch: async () => [] });
		const summary = await checkAccess(client, { task, entity, project, fields: [] });
		expect(calls.filter((c) => c.method === 'update').map((c) => c.args[0])).toEqual(['Shot']);
		expect(summary.checks[0]).toEqual({ capability: 'update_task', result: 'unknown', response: null });
	});

	it('rethrows what is not an API answer', async () => {
		const { client } = fakeClient({
			...reads(true),
			update: async () => {
				throw new TypeError('network down');
			}
		});
		await expect(checkAccess(client, { task, entity, project, fields: ['content'] })).rejects.toThrow('network down');
	});

	it('reads the mock site’s no-op PUT as allowed', async () => {
		// MockClient models neither 094's refusals nor a rolled-back batch's `detail`, and a bad-status
		// create lands there, so only the update probe is asserted against it.
		const mock = new MockClient();
		const row = mock.rowsOf('Task')[0] as { id: number; content: string };
		const shotRow = mock.rowsOf('Shot')[0] as { id: number };
		const sample = { ...task, id: row.id, fields: { content: row.content } };
		const summary = await checkAccess(mock, {
			task: sample,
			entity: { type: 'Shot', id: shotRow.id, entityType: 'Shot', taskTemplate: null },
			project: { type: 'Project', id: 1 },
			fields: ['content']
		});
		expect(summary.checks.find((c) => c.capability === 'update_task')?.result).toBe('allowed');
	});
});
