/**
 * Load: the read side of the I/O layer. Calls the client and hands the rows to `pure/read.ts`; no
 * logic of its own beyond paging and the request shapes.
 *
 * `client` is the signed-in one (`liveWriter()` or `liveContext().client`, `src/lib/live.ts`).
 * Every `_search` pages at 5000, the cap (082), until a short page (the client's `hasMore`, probe 006).
 * Template tasks are Task rows with `task_template` set and `project` null, read by `task_template`,
 * never by `project` (entity_types/TaskTemplate).
 */

import { SgApiError, type EntityRow, type FieldSchema, type SgClient, type WireGroup } from 'sg-widgets-core';
import {
	BASE_TASK_FIELDS,
	customFieldCandidates,
	fieldDisplayNames,
	defaultTemplateFor,
	entityFromRow,
	linkedTemplateTaskIds,
	snapshotsFromRows,
	taskFieldsFor,
	taskStatusContext,
	templatableTypes,
	templateOfFromRows,
	templatesFromRows
} from '$lib/pure/read';
import type { EntityRef, EntitySnapshot, FieldName, Id, ProjectContext, Template } from '$lib/pure/types';
import { runPool } from './pool';

/** 082: `page[size]` takes 1 to 5000. */
export const PAGE_SIZE = 5000;

/** How many schema reads run at once when looking for `task_template` across the site's types. */
const SCHEMA_CONCURRENCY = 8;

const ENTITY_FIELDS = ['code', 'task_template'];
const DEPENDENCY_FIELDS = ['task', 'dependent_task', 'dependency_type', 'offset_days'];

const and = (...conditions: WireGroup['conditions']): WireGroup => ({ logical_operator: 'and', conditions });
const ref = (type: string, id: Id) => ({ type, id });

/** Every row a filter matches, page by page. */
export async function searchAll(client: SgClient, entityType: string, filters: WireGroup, fields: string[]): Promise<EntityRow[]> {
	const rows: EntityRow[] = [];
	for (let number = 1; ; number++) {
		const page = await client.search(entityType, { filters, fields, page: { size: PAGE_SIZE, number } });
		rows.push(...page.data);
		if (!page.hasMore) return rows;
	}
}

/** Rows whose `field` is one of `refs`; no call when there are none. */
function searchIn(client: SgClient, entityType: string, field: string, refs: EntityRef[], fields: string[]): Promise<EntityRow[]> {
	if (refs.length === 0) return Promise.resolve([]);
	return searchAll(client, entityType, and([field, 'in', refs.map((r) => ref(r.type, r.id))]), fields);
}

/** One type's `task_template` field, or null when the type has none (404, or the 200 with no data). */
export async function taskTemplateField(client: SgClient, entityType: string, projectId: Id): Promise<FieldSchema | null> {
	try {
		return await client.fieldWithProject(entityType, 'task_template', projectId);
	} catch (error) {
		if (error instanceof SgApiError && (error.status === 404 || error.status === 200)) return null;
		throw error;
	}
}

/**
 * The entity types a template applies to, Task excluded (read.ts). One `GET /schema` for the list, then
 * one field read per type (1.2KB), never the whole `/fields` per type (002).
 */
export async function loadTemplatableTypes(client: SgClient, projectId: Id): Promise<string[]> {
	const names = (await client.entityTypes()).map((t) => t.name);
	const found = await runPool(names, SCHEMA_CONCURRENCY, (name) => taskTemplateField(client, name, projectId));
	const fieldsByType: Record<string, Record<string, FieldSchema>> = {};
	names.forEach((name, i) => {
		const field = found[i];
		if (field) fieldsByType[name] = { task_template: field };
	});
	return templatableTypes(fieldsByType);
}

/** Task's schema at project scope, for the custom policy fields and the access check. */
export function loadTaskSchema(client: SgClient, projectId: Id): Promise<Record<string, FieldSchema>> {
	return client.fields('Task', projectId);
}

/**
 * From one Task schema read at project scope: the custom Task fields to request (editable only,
 * read.ts `customFieldCandidates`) and every field's display name (`fieldDisplayNames`).
 */
export async function loadTaskFields(
	client: SgClient,
	projectId: Id
): Promise<{ custom: FieldName[]; labels: Record<FieldName, string> }> {
	const schema = await loadTaskSchema(client, projectId);
	return { custom: customFieldCandidates(schema), labels: fieldDisplayNames(schema) };
}

/** Every TaskTemplate on the site with its template tasks and the edges between them. */
export async function loadTemplates(client: SgClient, customFields: FieldName[]): Promise<Template[]> {
	const templates = await searchAll(client, 'TaskTemplate', and(), ['code', 'entity_type']);
	const tasks = await searchIn(
		client,
		'Task',
		'task_template',
		templates.map((t) => ref('TaskTemplate', t.id)),
		[...BASE_TASK_FIELDS, ...customFields]
	);
	const deps = await searchIn(
		client,
		'TaskDependency',
		'task',
		tasks.map((t) => ref('Task', t.id)),
		DEPENDENCY_FIELDS
	);
	return templatesFromRows(templates, tasks, deps);
}

/** Which entities to list: all of a type, those on one template, or those with none. */
export type EntityFilter = { kind: 'all' } | { kind: 'template'; templateId: Id } | { kind: 'no_template' };

/** One project's entities of a type, with their `code` and current `task_template`. */
export async function loadEntities(
	client: SgClient,
	projectId: Id,
	entityType: string,
	filter: EntityFilter
): Promise<EntitySnapshot['entity'][]> {
	const conditions: WireGroup['conditions'] = [['project', 'is', ref('Project', projectId)]];
	if (filter.kind === 'template') conditions.push(['task_template', 'is', ref('TaskTemplate', filter.templateId)]);
	if (filter.kind === 'no_template') conditions.push(['task_template', 'is', null]);
	const rows = await searchAll(client, entityType, and(...conditions), ENTITY_FIELDS);
	return rows.map(entityFromRow);
}

/** `Project.tracking_settings.default_task_template.<Type>` (088), or null. */
export async function loadDefaultTemplate(client: SgClient, projectId: Id, entityType: string): Promise<EntityRef | null> {
	const rows = await searchAll(client, 'Project', and(['id', 'is', projectId]), ['tracking_settings']);
	return defaultTemplateFor(rows[0]?.attributes?.tracking_settings, entityType);
}

/** The project's Task statuses: the usable set and the default (field_types/status_list). */
export async function loadProjectContext(client: SgClient, project: EntityRef): Promise<ProjectContext> {
	const field = await client.fieldWithProject('Task', 'sg_status_list', project.id);
	return { project, ...taskStatusContext(field) };
}

/**
 * One batch of entities, read for planning against `template`: their Tasks with the base fields and
 * the template's policy fields (read.ts `taskFieldsFor`), every TaskDependency row touching those
 * Tasks, the Versions and PublishedFiles on them (089), and the template of each linked template task.
 * `entities` are of one type, as a run is (brief 1).
 */
export async function loadSnapshots(
	client: SgClient,
	entities: EntityRef[],
	template: Template
): Promise<EntitySnapshot[]> {
	const readAt = new Date().toISOString();
	const entityType = entities[0]?.type;
	if (!entityType) return [];
	const entityRows = await searchAll(client, entityType, and(['id', 'in', entities.map((e) => e.id)]), ENTITY_FIELDS);
	const tasks = await searchIn(client, 'Task', 'entity', entities, taskFieldsFor(template));
	const taskRefs = tasks.map((t) => ref('Task', t.id));
	const linked = linkedTemplateTaskIds(tasks);
	const [dependencies, versions, publishedFiles, templateTasks] = await Promise.all([
		taskRefs.length === 0
			? Promise.resolve([])
			: searchAll(
					client,
					'TaskDependency',
					{ logical_operator: 'or', conditions: [['task', 'in', taskRefs], ['dependent_task', 'in', taskRefs]] },
					DEPENDENCY_FIELDS
				),
		searchIn(client, 'Version', 'sg_task', taskRefs, ['sg_task']),
		searchIn(client, 'PublishedFile', 'task', taskRefs, ['task']),
		linked.length === 0 ? Promise.resolve([]) : searchAll(client, 'Task', and(['id', 'in', linked]), ['task_template'])
	]);
	return snapshotsFromRows({
		entities: entityRows,
		tasks,
		dependencies,
		versions,
		publishedFiles,
		templateOf: templateOfFromRows(templateTasks),
		readAt
	});
}
