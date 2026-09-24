import { describe, expect, it } from 'vitest';
import { PLAN_CSV_COLUMNS, planToCsv } from './csv';
import { matchKey } from './matching';
import type {
	ClaimRow,
	ConflictRow,
	CreateRow,
	EdgePlan,
	Edge,
	EntityPlan,
	EntityTask,
	ExtraRow,
	Id,
	KeepRow,
	PlanWarning,
	Template,
	TemplateTask
} from './types';

// Steps and ids follow fixtures/recipe015-*.json: Animation 11, Character FX 12, Comp 13, FX 14.
const step = (id: number | null) => (id === null ? null : { type: 'Step', id, name: `step${id}` });

function core(id: Id, content: string | null, stepId: number | null) {
	return {
		id,
		content,
		step: step(stepId),
		key: matchKey(content, stepId),
		status: 'wtg',
		sortOrder: null,
		duration: null,
		estInMins: null,
		description: null,
		milestone: false,
		startDate: null,
		dueDate: null,
		assignees: [],
		reviewers: [],
		fields: {}
	};
}

function tt(id: Id, content: string, stepId: number | null, sortOrder: number, templateId = 202): TemplateTask {
	return { ...core(id, content, stepId), sortOrder, templateId };
}

function task(
	id: Id,
	content: string | null,
	stepId: number | null,
	opts: { link?: Id | null; linkTemplate?: Id | null; status?: string | null } = {}
): EntityTask {
	return {
		...core(id, content, stepId),
		status: opts.status === undefined ? 'wtg' : opts.status,
		entity: { type: 'Shot', id: 7557, name: 'sh010' },
		templateTask: opts.link ? { id: opts.link, templateId: opts.linkTemplate ?? null } : null,
		pinned: false,
		dependencyViolation: false,
		createdAt: '2026-09-02T15:58:21Z'
	};
}

const shot = { type: 'Shot', id: 7557, name: 'sh010', entityType: 'Shot', taskTemplate: null };

function emptyEdges(): EdgePlan {
	return { expectedAdded: [], affected: [], toExtras: [], mayMove: [], wouldViolate: [] };
}

function plan(overrides: Partial<EntityPlan> = {}): EntityPlan {
	return {
		entity: shot,
		templateId: 202,
		rows: [],
		edges: emptyEdges(),
		counts: { keep: 0, claim: 0, create: 0, extra: 0, conflict: 0 },
		warnings: [],
		needsClearFirst: false,
		noop: false,
		...overrides
	};
}

const tt2: Template = {
	id: 202,
	code: 'tt2',
	entityType: 'Shot',
	tasks: [tt(47201, 'comp', 11, 10), tt(47202, 'roto', 13, 20), tt(47203, 'paint', 14, 30)],
	edges: []
};

function rows(csv: string): string[] {
	// Strip the BOM and the trailing CRLF, split on the line ending.
	return csv.replace(/^﻿/, '').split('\r\n').filter((l) => l.length > 0);
}

/** Minimal RFC 4180 field splitter, quotes-aware, for asserting on a rendered line. */
function parseLine(line: string): string[] {
	const fields: string[] = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"' && line[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') {
				inQuotes = false;
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ',') {
			fields.push(field);
			field = '';
		} else {
			field += ch;
		}
	}
	fields.push(field);
	return fields;
}

function cellsOf(line: string): (name: string) => string {
	const cells = parseLine(line);
	return (name: string) => cells[PLAN_CSV_COLUMNS.indexOf(name as never)];
}

describe('PLAN_CSV_COLUMNS', () => {
	it('is the header row', () => {
		expect(rows(planToCsv([], tt2))[0]).toBe(PLAN_CSV_COLUMNS.join(','));
	});

	it('starts with a UTF-8 BOM and uses CRLF line endings', () => {
		const csv = planToCsv([], tt2);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv.slice(1)).toBe(`${PLAN_CSV_COLUMNS.join(',')}\r\n`);
	});
});

describe('planToCsv: task rows', () => {
	it('writes a keep row with no field changes', () => {
		const keepRow: KeepRow = {
			kind: 'keep',
			task: task(47296, 'comp', 11, { link: 47201, linkTemplate: 202 }),
			templateTask: tt2.tasks[0],
			keyMismatch: false,
			fieldChanges: [],
			rename: null
		};
		const out = rows(planToCsv([plan({ rows: [keepRow] })], tt2));
		expect(out).toHaveLength(2);
		const col = cellsOf(out[1]);
		expect(col('entity_type')).toBe('Shot');
		expect(col('entity_id')).toBe('7557');
		expect(col('entity_name')).toBe('sh010');
		expect(col('action')).toBe('keep');
		expect(col('task_id')).toBe('47296');
		expect(col('current_name')).toBe('comp');
		expect(col('template_task_id')).toBe('47201');
		expect(col('template_name')).toBe('comp');
		expect(col('field_changes')).toBe('');
	});

	it('writes a claim row with the old template link', () => {
		const claimRow: ClaimRow = {
			kind: 'claim',
			task: task(47297, 'paint', 14),
			templateTask: tt2.tasks[2],
			previousTemplateTask: { id: 47102, name: 'roto', templateId: 201 },
			fieldChanges: [],
			rename: null
		};
		const out = rows(planToCsv([plan({ rows: [claimRow] })], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('claim');
		expect(col('previous_template_task')).toBe('47102 (roto)');
	});

	it('writes a create row with no task id, from the template task', () => {
		const createRow: CreateRow = {
			kind: 'create',
			templateTask: tt2.tasks[1],
			templateDates: { start: null, due: null },
			datesClearable: true
		};
		const out = rows(planToCsv([plan({ rows: [createRow] })], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('create');
		expect(col('task_id')).toBe('');
		expect(col('template_task_id')).toBe('47202');
		expect(col('template_name')).toBe('roto');
	});

	it('writes an extra row with usage counts and the extra action', () => {
		const extraRow: ExtraRow = {
			kind: 'extra',
			task: task(47295, 'roto', 12),
			action: 'delete',
			usage: { versions: 2, publishedFiles: 1 },
			reason: 'not_in_template'
		};
		const out = rows(planToCsv([plan({ rows: [extraRow] })], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('extra');
		expect(col('extra_action')).toBe('delete');
		expect(col('versions')).toBe('2');
		expect(col('published_files')).toBe('1');
	});

	it('writes a conflict row listing every candidate', () => {
		const a = task(47297, 'paint', 14, { status: 'ip' });
		const b = task(47299, 'paint', 14);
		const conflictRow: ConflictRow = {
			kind: 'conflict',
			key: matchKey('paint', 14),
			templateTasks: [tt2.tasks[2]],
			candidates: [
				{ task: b, usage: { versions: 1, publishedFiles: 0 } },
				{ task: a, usage: { versions: 0, publishedFiles: 0 } }
			],
			prePick: { 47203: 47299 },
			reason: 'usage',
			pick: { 47203: 47299 }
		};
		const out = rows(planToCsv([plan({ rows: [conflictRow] })], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('conflict');
		expect(col('task_id')).toBe('47299, 47297');
		expect(col('versions')).toBe('1, 0');
		expect(col('warnings')).toContain('pre-pick (usage): 47299');
	});
});

describe('planToCsv: field changes', () => {
	it('lists field, current, template, policy and result', () => {
		const keepRow: KeepRow = {
			kind: 'keep',
			task: task(47296, 'comp', 11, { link: 47201, linkTemplate: 202 }),
			templateTask: tt2.tasks[0],
			keyMismatch: false,
			fieldChanges: [
				{ field: 'duration', current: null, template: 480, policy: 'fill_if_empty', result: 480 },
				{ field: 'milestone', current: false, template: true, policy: 'overwrite', result: true }
			],
			rename: null
		};
		const out = rows(planToCsv([plan({ rows: [keepRow] })], tt2));
		const col = cellsOf(out[1])('field_changes');
		expect(col).toBe(
			'duration: ∅ -> 480 [fill_if_empty => 480]; milestone: false -> true [overwrite => true]'
		);
	});
});

describe('planToCsv: edges', () => {
	const templateEdge: Edge = { id: null, downstream: 47203, upstream: 47201, type: 'start-to-start', offsetDays: 1 };

	it('writes an edge-add row between two mapped tasks', () => {
		const p = plan({
			edges: {
				...emptyEdges(),
				expectedAdded: [
					{ templateEdge, downstream: { existing: 47297 }, upstream: { existing: 47296 } }
				]
			}
		});
		const out = rows(planToCsv([p], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('edge-add');
		expect(col('edge_type')).toBe('start-to-start');
		expect(col('edge_offset_days')).toBe('1');
	});

	it('marks a created end as new', () => {
		const p = plan({
			edges: {
				...emptyEdges(),
				expectedAdded: [
					{ templateEdge, downstream: { created: 47203 }, upstream: { existing: 47296 } }
				]
			}
		});
		const out = rows(planToCsv([p], tt2));
		const col = cellsOf(out[1]);
		expect(col('task_id')).toBe('');
		expect(col('current_name')).toBe('paint (new)');
	});

	it('writes an edge-delete row with the keep/remove decision', () => {
		const p = plan({
			edges: {
				...emptyEdges(),
				affected: [
					{
						existing: { id: 9001, downstream: 47296, upstream: 47297, type: 'finish-to-start-next-day', offsetDays: null },
						cause: 'not_in_template',
						replacedBy: null,
						action: 'remove'
					}
				]
			}
		});
		const out = rows(planToCsv([p], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('edge-delete');
		expect(col('edge_decision')).toBe('remove');
	});

	it('writes an edge-replace row showing both types and offsets', () => {
		const p = plan({
			edges: {
				...emptyEdges(),
				affected: [
					{
						existing: { id: 9001, downstream: 47297, upstream: 47296, type: 'finish-to-finish', offsetDays: 0 },
						cause: 'replaced',
						replacedBy: { id: null, downstream: 47297, upstream: 47296, type: 'start-to-start', offsetDays: 1 },
						action: 'keep'
					}
				]
			}
		});
		const out = rows(planToCsv([p], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('edge-replace');
		expect(col('edge_type')).toBe('finish-to-finish -> start-to-start');
		expect(col('edge_offset_days')).toBe('0 -> 1');
		expect(col('edge_decision')).toBe('keep');
	});

	it('writes an edge-extra row for an edge to an extra Task, always kept', () => {
		const p = plan({
			edges: {
				...emptyEdges(),
				toExtras: [{ id: 9002, downstream: 47296, upstream: 47295, type: 'finish-to-start-next-day', offsetDays: null }]
			}
		});
		const out = rows(planToCsv([p], tt2));
		const col = cellsOf(out[1]);
		expect(col('action')).toBe('edge-extra');
		expect(col('edge_decision')).toBe('keep');
	});
});

describe('planToCsv: quoting', () => {
	it('quotes a cell holding a comma', () => {
		const p = plan({ entity: { ...shot, name: 'sh010, v2' } });
		const out = rows(planToCsv([p], tt2));
		expect(out[1]).toContain('"sh010, v2"');
	});

	it('doubles an embedded quote', () => {
		const p = plan({ entity: { ...shot, name: 'sh "hero" 010' } });
		const out = rows(planToCsv([p], tt2));
		expect(out[1]).toContain('"sh ""hero"" 010"');
	});

	it('quotes a cell holding a newline', () => {
		const warning: PlanWarning = { code: 'access_short', detail: 'short on\nupdate' };
		const p = plan({ warnings: [warning] });
		const csv = planToCsv([p], tt2);
		expect(csv).toContain('"access: short on\nupdate"');
	});

	it('prefixes a formula-like cell with a quote', () => {
		const p = plan({ entity: { ...shot, name: '=SUM(A1)' } });
		const out = rows(planToCsv([p], tt2));
		expect(out[1]).toContain("'=SUM(A1)");
	});
});

describe('planToCsv: warnings', () => {
	it('attaches an entity-level warning to the first row', () => {
		const keepRow: KeepRow = {
			kind: 'keep',
			task: task(47296, 'comp', 11, { link: 47201, linkTemplate: 202 }),
			templateTask: tt2.tasks[0],
			keyMismatch: false,
			fieldChanges: [],
			rename: null
		};
		const warning: PlanWarning = {
			code: 'template_entity_type_mismatch',
			templateType: 'Asset',
			entityType: 'Shot'
		};
		const p = plan({ rows: [keepRow], warnings: [warning] });
		const out = rows(planToCsv([p], tt2));
		expect(out).toHaveLength(2);
		expect(out[1]).toContain('template entity_type Asset vs entity Shot');
	});

	it('emits a placeholder row for a noop entity with no plan rows', () => {
		const p = plan({ noop: true });
		const out = rows(planToCsv([p], tt2));
		expect(out).toHaveLength(2);
		expect(out[1]).toContain('noop');
	});

	it('still shows an entity-level warning when there are no plan rows', () => {
		const warning: PlanWarning = { code: 'access_short', detail: 'no delete permission' };
		const p = plan({ warnings: [warning] });
		const out = rows(planToCsv([p], tt2));
		expect(out).toHaveLength(2);
		expect(out[1]).toContain('access: no delete permission');
	});
});

describe('planToCsv: multiple entities', () => {
	it('lists every entity in order, each entity as consecutive rows', () => {
		const keepA: KeepRow = {
			kind: 'keep',
			task: task(47296, 'comp', 11, { link: 47201, linkTemplate: 202 }),
			templateTask: tt2.tasks[0],
			keyMismatch: false,
			fieldChanges: [],
			rename: null
		};
		const shotB = { type: 'Shot', id: 7558, name: 'sh020', entityType: 'Shot', taskTemplate: null };
		const createB: CreateRow = {
			kind: 'create',
			templateTask: tt2.tasks[1],
			templateDates: { start: null, due: null },
			datesClearable: true
		};
		const out = rows(
			planToCsv([plan({ rows: [keepA] }), plan({ entity: shotB, rows: [createB] })], tt2)
		);
		expect(out).toHaveLength(3);
		expect(cellsOf(out[1])('entity_id')).toBe('7557');
		expect(cellsOf(out[2])('entity_id')).toBe('7558');
	});
});
