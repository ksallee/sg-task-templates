/**
 * Access: sends the preflight `pure/access.ts` builds and hands the answers back to it (probe 094,
 * recipe 017). Nothing here decides anything: the requests, the classification and the summary are
 * all pure. The four probes run one after another, each refused or rolled back by the server before
 * it lands.
 *
 * 017 confirms the delete check's sentinel id is free with `GET /entity/tasks/<id>` answering 404. The
 * client has no read by id, so this reads it with a `_search` on `id`: an empty answer stands for the
 * 404. When the sentinel exists, the delete check is not run and stays `unknown`.
 */

import { SgApiError, type EntityRow, type SgClient } from 'sg-widgets-core';
import {
	ACCESS_DELETE_SENTINEL_ID,
	accessResponseFrom,
	buildAccessProbeRequests,
	classifyAccessResponse,
	runFieldAccess,
	summarizeAccess
} from '$lib/pure/access';
import { taskTemplateField } from './load';
import type {
	AccessCapability,
	AccessCheck,
	AccessResponse,
	AccessSummary,
	EntityRef,
	EntitySnapshot,
	EntityTask,
	FieldName,
	Id
} from '$lib/pure/types';

/** A call's answer as `AccessResponse`: `ok` on success, the error's status and first error on a refusal. */
async function answer(call: () => Promise<unknown>, ok: number): Promise<AccessResponse> {
	try {
		await call();
		return { status: ok, title: null, detail: null };
	} catch (error) {
		if (error instanceof SgApiError) return accessResponseFrom(error.status, error.body);
		throw error;
	}
}

async function one(client: SgClient, entityType: string, id: Id, fields: string[]): Promise<EntityRow | null> {
	const page = await client.search(entityType, {
		filters: { logical_operator: 'and', conditions: [['id', 'is', id]] },
		fields,
		page: { size: 1, number: 1 }
	});
	return page.data[0] ?? null;
}

/**
 * Whether the signed-in person looks able to run the plan on `entity`: a sample `task` on it, the
 * Task `fields` the plan writes. Returns the pure summary; `buildAccessWarning` turns it into the
 * plan's warning.
 */
export async function checkAccess(
	client: SgClient,
	input: { task: EntityTask; entity: EntitySnapshot['entity']; project: EntityRef; fields: FieldName[] }
): Promise<AccessSummary> {
	const { task, entity, project, fields } = input;
	const [taskSchema, entityTaskTemplate, entityRow, sentinel] = await Promise.all([
		client.fields('Task', project.id),
		taskTemplateField(client, entity.entityType, project.id),
		one(client, entity.entityType, entity.id, ['code']),
		one(client, 'Task', ACCESS_DELETE_SENTINEL_ID, ['id'])
	]);
	const code = entityRow?.attributes?.code;
	const requests = buildAccessProbeRequests({
		task,
		entity,
		entityCode: typeof code === 'string' ? code : null,
		project,
		fields
	});

	const responses: Record<AccessCapability, AccessResponse | null> = {
		update_task: requests.updateTask
			? await answer(() => client.update('Task', task.id, requests.updateTask!.body), 200)
			: null,
		update_entity: await answer(() => client.update(entity.entityType, entity.id, requests.updateEntity.body), 200),
		create_task: await answer(() => client.create('Task', requests.createTask.body), 201),
		delete_task: sentinel === null ? await answer(() => client.batch(requests.deleteTask), 200) : null
	};
	const checks: AccessCheck[] = (Object.keys(responses) as AccessCapability[]).map((capability) => ({
		capability,
		response: responses[capability],
		result: classifyAccessResponse(
			capability,
			responses[capability],
			capability === 'update_entity' ? entity.entityType : 'Task'
		)
	}));
	return summarizeAccess(checks, runFieldAccess(taskSchema, fields, entity.entityType, entityTaskTemplate));
}
