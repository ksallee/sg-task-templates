/**
 * Access preflight: pure request-building and response classification for probe 094 (recipe
 * 017_check_permission_before_writing). Learns, before any write, whether the signed-in caller may
 * update a Task, update the entity, create a Task and delete a Task, with calls the server refuses
 * before they land: a plain no-op PUT of the current value (update), a plain POST with a bad status
 * (create), a `_batch` of [delete, update of a missing id] that rolls back (delete). Permission is
 * checked first; an allowed caller gets a different error and nothing is written either way (094).
 *
 * The I/O that sends these requests, reads the schema and parses the HTTP responses into
 * `AccessResponse` is not in scope here: this module only builds what to send and classifies what
 * comes back. That I/O must:
 * - read `GET /schema/<Type>/fields?project_id=<id>` with the project, as 017's `editable_fields`
 *   does: `editable` is per caller there (094). sg-widgets' schema service (schema-service.ts:9)
 *   reads fields at site scope, so it cannot serve this read.
 * - before the delete check, confirm `GET /entity/tasks/999999999` is a 404, as 017's `_rolled_back`
 *   does, and not run the check otherwise.
 *
 * 094's caveat carries through: the refused branch was measured via `sudo_as_login`. This app checks
 * with the person's App Session Launcher session (052), which was not measured as a refused caller,
 * so a response this module does not recognize classifies as `unknown`, never `refused` or
 * `allowed`. `summarizeAccess` never lets an unknown make the write look short.
 */

import type {
	AccessCapability,
	AccessCheck,
	AccessPostRequest,
	AccessProbeRequests,
	AccessPutRequest,
	AccessResponse,
	AccessResult,
	AccessSummary,
	BatchRequest,
	EntitySnapshot,
	EntityRef,
	EntityTask,
	FieldName,
	PlanWarning,
	SchemaFieldAccess
} from './types';
import type { FieldSchema } from 'sg-widgets-core';

/** A Task id that does not exist, so the delete check's batch always rolls back (094, 017). */
export const ACCESS_DELETE_SENTINEL_ID = 999999999;

export const ACCESS_INVALID_STATUS = 'zz_not_a_status';

/** The create check's `content`, as 017's `can_create_task` sends it. */
export const ACCESS_CREATE_CONTENT = 'permission check';

const CAPABILITY_LABEL: Record<AccessCapability, string> = {
	update_task: 'update Tasks',
	update_entity: 'update the entity',
	create_task: 'create Tasks',
	delete_task: 'delete Tasks'
};

/**
 * The four probe requests for one run (017): a no-op PUT of the sample Task's current values for
 * the fields the plan will write, a no-op PUT of the entity's current `code`, a plain POST with an
 * invalid status, and the delete rollback `_batch`. `fields` are wire names already under policy, so
 * their current values live on `task.fields` (types.ts, `TaskCore.fields`). `entityCode` is the
 * entity's current `code`, read with `GET /entity/<slug>/<id>?fields=code` as 017's `can_update` does.
 *
 * No fields, no update probe: an empty PUT answers 200 for every caller (094 candidate 5), so
 * `updateTask` is `null` and its result stays `unknown`.
 *
 * 094 ran the entity PUT on a Shot's `code` only; an Asset's was read in the schema, never PUT.
 */
export function buildAccessProbeRequests(input: {
	task: EntityTask;
	entity: EntitySnapshot['entity'];
	entityCode: string;
	project: EntityRef;
	fields: FieldName[];
}): AccessProbeRequests {
	const { task, entity, entityCode, project, fields } = input;
	const updateTask: AccessPutRequest | null =
		fields.length === 0
			? null
			: {
					method: 'PUT',
					entity: 'Task',
					record_id: task.id,
					body: Object.fromEntries(fields.map((f) => [f, task.fields[f]]))
				};
	const updateEntity: AccessPutRequest = {
		method: 'PUT',
		entity: entity.entityType,
		record_id: entity.id,
		body: { code: entityCode }
	};
	const createTask: AccessPostRequest = {
		method: 'POST',
		entity: 'Task',
		body: {
			project: { type: 'Project', id: project.id },
			entity: { type: entity.type, id: entity.id },
			content: ACCESS_CREATE_CONTENT,
			sg_status_list: ACCESS_INVALID_STATUS
		}
	};
	const deleteTask: BatchRequest[] = [
		{ request_type: 'delete', entity: 'Task', record_id: task.id },
		{
			request_type: 'update',
			entity: 'Task',
			record_id: ACCESS_DELETE_SENTINEL_ID,
			data: { content: 'x' }
		}
	];
	return { updateTask, updateEntity, createTask, deleteTask };
}

const notEditablePrefix = (type: string) => `The field is not editable for this user: [${type}.`;

/**
 * 094 rows 2 and 4: an unconditional refusal ends at the field, `[Task.content].`. Row 3: a
 * conditional rule continues after it, `[Task.sg_status_list]. Rule: Artist -- PermissionRule 2615: ...`.
 */
function isNotEditableRefusal(type: string, title: string): boolean {
	if (!title.startsWith(notEditablePrefix(type))) return false;
	const rest = title.slice(notEditablePrefix(type).length);
	const end = rest.indexOf('].');
	if (end <= 0) return false;
	const after = rest.slice(end + 2);
	return after === '' || after.startsWith(' Rule: ');
}

function isCannotBeCreatedRefusal(type: string, title: string): boolean {
	return title === `Entity of type ${type} cannot be created by this user.`;
}

function isCannotBeDeletedRefusal(type: string, title: string): boolean {
	return title === `Entity of type ${type} can not be deleted by this user.`;
}

/** 017 `_rolled_back`: `f"id={SENTINEL_ID} does not exist" in detail`. */
function isSentinelNotFound(detail: string): boolean {
	return detail.includes(`id=${ACCESS_DELETE_SENTINEL_ID} does not exist`);
}

function isInvalidStatusValidation(title: string): boolean {
	return title.includes('is not a valid status');
}

/**
 * `response` to `allowed` / `refused` / `unknown`, by status and the exact text the corpus records
 * (094, 017). `title` for every refusal and for the create check's invalid status; `detail` for the
 * delete check's sentinel, as 017 reads it. `entityType` is `'Task'` for every capability but
 * `update_entity`, where it is the entity's own type.
 */
export function classifyAccessResponse(
	capability: AccessCapability,
	response: AccessResponse | null,
	entityType: string
): AccessResult {
	if (response === null) return 'unknown';
	const { status, title, detail } = response;
	switch (capability) {
		case 'update_task':
		case 'update_entity':
			if (status === 200) return 'allowed';
			if (status === 400 && title !== null && isNotEditableRefusal(entityType, title)) return 'refused';
			return 'unknown';
		case 'create_task':
			if (status === 400 && title !== null && isInvalidStatusValidation(title)) return 'allowed';
			if (status === 400 && title !== null && isCannotBeCreatedRefusal(entityType, title)) return 'refused';
			return 'unknown';
		case 'delete_task':
			if (status === 404 && detail !== null && isSentinelNotFound(detail)) return 'allowed';
			if (status === 400 && title !== null && isCannotBeDeletedRefusal(entityType, title)) return 'refused';
			return 'unknown';
		default:
			return 'unknown';
	}
}

/** `editable` per field (094): `false` = refused without a write; `true` = maybe (a rule may still refuse it). */
export function schemaFieldAccess(fields: Record<FieldName, FieldSchema>): Record<FieldName, SchemaFieldAccess> {
	const out: Record<FieldName, SchemaFieldAccess> = {};
	for (const [name, schema] of Object.entries(fields)) {
		out[name] = schema.editable ? 'maybe' : 'refused';
	}
	return out;
}

/** `looksShort` on any refusal, capability or field. Unknown never sets it (094's caveat). */
export function summarizeAccess(
	checks: AccessCheck[],
	fields: Record<FieldName, SchemaFieldAccess>
): AccessSummary {
	const looksShort =
		checks.some((c) => c.result === 'refused') || Object.values(fields).some((v) => v === 'refused');
	return { checks, fields, looksShort };
}

/** The plan's `access_short` warning, or `null` when nothing looks short. */
export function buildAccessWarning(summary: AccessSummary): PlanWarning | null {
	if (!summary.looksShort) return null;
	const refusedCapabilities = summary.checks
		.filter((c) => c.result === 'refused')
		.map((c) => CAPABILITY_LABEL[c.capability]);
	const refusedFields = Object.entries(summary.fields)
		.filter(([, v]) => v === 'refused')
		.map(([name]) => name);
	const parts: string[] = [];
	if (refusedCapabilities.length > 0) parts.push(`cannot ${refusedCapabilities.join(', ')}`);
	if (refusedFields.length > 0) parts.push(`cannot write ${refusedFields.join(', ')}`);
	const detail =
		`Write access looks short: ${parts.join('; ')}. The corpus measured these refusals via sudo_as ` +
		`(094); this check ran with the launcher session, a case that is unmeasured, so a response ` +
		`this run does not recognize is left unknown, not assumed refused.`;
	return { code: 'access_short', detail, checks: summary.checks, fields: summary.fields };
}
