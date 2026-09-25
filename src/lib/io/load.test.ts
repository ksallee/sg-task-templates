import { describe, expect, it } from 'vitest';
import { SgApiError, type EntityRow, type FieldSchema } from 'sg-widgets-core';
import { MockClient } from 'sg-widgets-core/mock';
import {
	PAGE_SIZE,
	loadDefaultTemplate,
	loadEntities,
	loadProjectContext,
	loadSnapshots,
	loadTemplatableTypes,
	loadTemplates,
	searchAll
} from './load';
import { fakeClient, searches } from './fake-client';
import { taskFieldsFor, templateFromRows } from '$lib/pure/read';
import templates from '$lib/pure/fixtures/recipe015-templates.json';
import shotBefore from '$lib/pure/fixtures/recipe015-shot-before.json';
import project from '$lib/pure/fixtures/project.json';

const field = (name: string, entityType: string): FieldSchema => ({
	name,
	displayName: name,
	entityType,
	dataType: 'entity',
	editable: true,
	mandatory: false,
	unique: false
});

const tt2 = () =>
	templateFromRows(
		templates.templates[1] as EntityRow,
		templates.templateTasks.filter((t) => t.relationships.task_template.data?.id === 202) as EntityRow[],
		templates.templateDependencies as EntityRow[]
	);

describe('searchAll', () => {
	it('pages at 5000 (082) until a short page', async () => {
		const rows = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => ({ type: 'Task', id: i + 1, attributes: {}, relationships: {} }));
		const { client, calls } = fakeClient({}, { Task: rows });
		const out = await searchAll(client, 'Task', { logical_operator: 'and', conditions: [] }, ['content']);
		expect(out).toHaveLength(PAGE_SIZE + 3);
		expect(searches(calls, 'Task').map((s) => s.page)).toEqual([
			{ size: 5000, number: 1 },
			{ size: 5000, number: 2 }
		]);
	});
});

describe('loadTemplatableTypes', () => {
	const hosts = (validTypes: string[]): FieldSchema => ({ ...field('entity', 'Task'), validTypes });

	it('reads Task.entity once, then task_template only on the types a Task links to', async () => {
		const { client, calls } = fakeClient({
			entityTypes: async () => {
				throw new Error('no /schema walk');
			},
			fieldWithProject: async (type, name) => {
				if (type === 'Task' && name === 'entity') return hosts(['Shot', 'Task', 'MocapTake', 'CustomEntity07']);
				if (type === 'MocapTake') throw new SgApiError(404, null, 'not found');
				return field('task_template', type);
			}
		});
		expect(await loadTemplatableTypes(client, 1180)).toEqual(['Shot', 'CustomEntity07']);
		expect(calls.map((c) => `${c.args[0]}.${c.args[1]}`)).toEqual(['Task.entity', 'Shot.task_template', 'MocapTake.task_template', 'CustomEntity07.task_template']);
	});

	it('rethrows any other failure', async () => {
		const { client } = fakeClient({
			fieldWithProject: async (type) => {
				if (type === 'Task') return hosts(['Shot']);
				throw new SgApiError(500, null, 'boom');
			}
		});
		await expect(loadTemplatableTypes(client, 1)).rejects.toThrow('boom');
	});
});

describe('loadTemplates', () => {
	it('reads templates, their tasks by task_template and the edges between them', async () => {
		const { client, calls } = fakeClient(
			{},
			{
				TaskTemplate: templates.templates as EntityRow[],
				Task: templates.templateTasks as EntityRow[],
				TaskDependency: templates.templateDependencies as EntityRow[]
			}
		);
		const out = await loadTemplates(client, ['sg_priority_1']);
		expect(out.map((t) => [t.code, t.tasks.length, t.edges.length])).toEqual([
			['tt1', 2, 0],
			['tt2', 3, 1]
		]);
		const [task] = searches(calls, 'Task');
		expect(task.filters?.conditions).toEqual([
			[
				'task_template',
				'in',
				[
					{ type: 'TaskTemplate', id: 201 },
					{ type: 'TaskTemplate', id: 202 }
				]
			]
		]);
		expect(task.fields).toContain('sg_priority_1');
		expect(task.fields).toContain('template_task');
		const [deps] = searches(calls, 'TaskDependency');
		expect((deps.filters?.conditions[0] as unknown[])[0]).toBe('task');
	});

	it('makes no Task call when the site has no templates', async () => {
		const { client, calls } = fakeClient({}, {});
		expect(await loadTemplates(client, [])).toEqual([]);
		expect(searches(calls, 'Task')).toEqual([]);
	});
});

describe('loadEntities', () => {
	const run = async (filter: Parameters<typeof loadEntities>[3]) => {
		const { client, calls } = fakeClient({}, { Shot: [shotBefore.shot as EntityRow] });
		const out = await loadEntities(client, 1180, 'Shot', filter);
		return { out, filters: searches(calls, 'Shot')[0].filters?.conditions };
	};
	const inProject = ['project', 'is', { type: 'Project', id: 1180 }];

	it('lists every entity of the type in the project', async () => {
		const { out, filters } = await run({ kind: 'all' });
		expect(filters).toEqual([inProject]);
		expect(out[0]).toMatchObject({ type: 'Shot', id: shotBefore.shot.id, entityType: 'Shot' });
	});

	it('lists those on one template', async () => {
		const { filters } = await run({ kind: 'template', templateId: 202 });
		expect(filters).toEqual([inProject, ['task_template', 'is', { type: 'TaskTemplate', id: 202 }]]);
	});

	it('lists those with no template', async () => {
		const { filters } = await run({ kind: 'no_template' });
		expect(filters).toEqual([inProject, ['task_template', 'is', null]]);
	});

	it('reads the mock site’s Shots with their template link', async () => {
		const mock = new MockClient();
		const projectId = (mock.rowsOf('Project')[0] as { id: number }).id;
		const out = await loadEntities(mock, projectId, 'Shot', { kind: 'all' });
		// Every Shot of the project, each with the template the mock's own row links, or none.
		const rows = mock.rowsOf('Shot').filter((r) => (r.project as { id: number } | null)?.id === projectId);
		const linked = (r: (typeof rows)[number]) => (r.task_template as { id: number } | null)?.id ?? null;
		const byId = new Map(rows.map((r) => [r.id as number, linked(r)]));
		expect(out.map((e) => e.id).sort((a, b) => a - b)).toEqual([...byId.keys()].sort((a, b) => a - b));
		expect(out.every((e) => e.entityType === 'Shot' && (e.taskTemplate?.id ?? null) === byId.get(e.id))).toBe(true);
		expect(out.some((e) => e.taskTemplate?.type === 'TaskTemplate')).toBe(true);
		expect(out.some((e) => e.taskTemplate === null)).toBe(true);
	});
});

describe('loadDefaultTemplate', () => {
	it('reads tracking_settings off the project (088)', async () => {
		const { client, calls } = fakeClient({}, { Project: [{ ...project, relationships: {} }] });
		expect(await loadDefaultTemplate(client, 1180, 'Shot')).toEqual({ type: 'TaskTemplate', id: 202, name: 'tt2' });
		expect(await loadDefaultTemplate(client, 1180, 'Asset')).toBeNull();
		expect(searches(calls, 'Project')[0].fields).toEqual(['tracking_settings']);
	});
});

describe('loadProjectContext', () => {
	it('reads the project’s Task statuses from the mock site', async () => {
		const mock = new MockClient();
		const ctx = await loadProjectContext(mock, { type: 'Project', id: 1 });
		expect(ctx.defaultTaskStatus).toBe('wtg');
		expect(ctx.validTaskStatuses).toContain('wtg');
		expect(ctx.project).toEqual({ type: 'Project', id: 1 });
	});
});

describe('loadSnapshots', () => {
	const shot = shotBefore.shot as EntityRow;
	const ref = { type: 'Shot', id: shot.id };
	const version: EntityRow = {
		type: 'Version',
		id: 1,
		attributes: {},
		relationships: { sg_task: { data: { type: 'Task', id: 47296 } } }
	};

	it('reads Tasks, edges, usage and linked template tasks for one batch', async () => {
		const { client, calls } = fakeClient(
			{
				search: async (type, options) => {
					const conditions = options.filters?.conditions ?? [];
					const data: Record<string, EntityRow[]> = {
						Shot: [shot],
						Version: [version],
						// The second Task read resolves the linked template tasks.
						Task: (conditions[0] as unknown[])[0] === 'id' ? (templates.templateTasks as EntityRow[]) : (shotBefore.tasks as EntityRow[])
					};
					return { data: data[type] ?? [], hasMore: false };
				}
			},
			{}
		);
		const template = tt2();
		const [snap] = await loadSnapshots(client, [ref], template);

		expect(snap.entity).toMatchObject(ref);
		expect(snap.tasks.map((t) => t.id)).toEqual([47295, 47296, 47297]);
		expect(snap.tasks[0].templateTask).toEqual({ id: 47102, name: 'roto', templateId: 201 });
		expect(snap.usage).toEqual({ 47296: { versions: 1, publishedFiles: 0 } });

		const [tasks, linked] = searches(calls, 'Task');
		expect(tasks.fields).toEqual(taskFieldsFor(template));
		expect(tasks.filters?.conditions).toEqual([['entity', 'in', [ref]]]);
		expect(linked.filters?.conditions).toEqual([['id', 'in', [47102, 47101]]]);
		expect(linked.fields).toEqual(['task_template']);

		const taskRefs = [47295, 47296, 47297].map((id) => ({ type: 'Task', id }));
		expect(searches(calls, 'TaskDependency')[0].filters).toEqual({
			logical_operator: 'or',
			conditions: [
				['task', 'in', taskRefs],
				['dependent_task', 'in', taskRefs]
			]
		});
		expect(searches(calls, 'Version')[0].filters?.conditions).toEqual([['sg_task', 'in', taskRefs]]);
		expect(searches(calls, 'PublishedFile')[0].filters?.conditions).toEqual([['task', 'in', taskRefs]]);
		expect(searches(calls, 'Version')[0].page?.size).toBe(5000);
	});

	it('makes no call for an empty batch', async () => {
		const { client, calls } = fakeClient({});
		expect(await loadSnapshots(client, [], tt2())).toEqual([]);
		expect(calls).toEqual([]);
	});
});
