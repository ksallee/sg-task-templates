import { describe, expect, it } from 'vitest';
import { PLAN_CSV_COLUMNS, PLAN_CSV_HEADERS, planToCsv } from './csv';
import { matchKey } from './matching';
import { planEntity, withConflictPick, withEntityConflictPick, withExtraOverride } from './planner';
import type {
	Edge,
	EdgeAction,
	EntityPlan,
	EntitySnapshot,
	EntityTask,
	FieldName,
	Id,
	ProjectContext,
	RunOptions,
	TaskUsage,
	Template,
	TemplateTask
} from './types';

// Fixtures follow recipe 015 (fixtures/recipe015-*.json): steps Animation 11, Character FX 12,
// Comp 13, FX 14; template tt1 = 201, tt2 = 202. Every plan comes from the real planEntity.

const step = (id: number | null) => (id === null ? null : { type: 'Step', id, name: `step${id}` });

function core(id: Id, content: string | null, stepId: number | null, fields: Record<FieldName, unknown> = {}) {
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
		fields: { content, step: step(stepId), ...fields }
	};
}

function tt(
	id: Id,
	content: string,
	stepId: number | null,
	sortOrder: number,
	o: { fields?: Record<FieldName, unknown>; start?: string; due?: string } = {}
): TemplateTask {
	return {
		...core(id, content, stepId, o.fields),
		sortOrder,
		startDate: o.start ?? null,
		dueDate: o.due ?? null,
		templateId: 202
	};
}

function task(
	id: Id,
	content: string | null,
	stepId: number | null,
	o: {
		link?: Id;
		linkTemplate?: Id;
		status?: string;
		createdAt?: string;
		fields?: Record<FieldName, unknown>;
	} = {}
): EntityTask {
	return {
		...core(id, content, stepId, o.fields),
		status: o.status ?? 'wtg',
		entity: { type: 'Shot', id: 7557, name: 'sh010' },
		templateTask: o.link ? { id: o.link, templateId: o.linkTemplate ?? null } : null,
		pinned: false,
		dependencyViolation: false,
		createdAt: o.createdAt ?? '2026-09-02T15:58:21Z'
	};
}

function edge(
	id: Id | null,
	downstream: Id,
	upstream: Id,
	type: Edge['type'] = 'start-to-start',
	offsetDays: number | null = 1
): Edge {
	return { id, downstream, upstream, type, offsetDays };
}

// tt2 of recipe 015: comp@Animation, roto@Comp, paint@FX; comp depends on paint, start-to-start 1.
const tt2: Template = {
	id: 202,
	code: 'tt2',
	entityType: 'Shot',
	tasks: [
		tt(47201, 'comp', 11, 10),
		tt(47202, 'roto', 13, 20, { start: '2026-03-02', due: '2026-03-04' }),
		tt(47203, 'paint', 14, 30)
	],
	edges: [edge(900, 47201, 47203)]
};

const ctx: ProjectContext = {
	project: { type: 'Project', id: 1180 },
	defaultTaskStatus: 'wtg',
	validTaskStatuses: ['wtg', 'ip', 'fin', 'omt']
};

const opts: RunOptions = {
	fieldPolicies: {},
	extraByName: {},
	extraOverrides: {},
	omitStatus: 'omt',
	conflictPicks: {},
	edgeActions: {},
	clearCreatedDates: false,
};

function snap(
	tasks: EntityTask[],
	o: { usage?: Record<Id, TaskUsage>; taskTemplate?: Id; id?: Id; name?: string; edges?: Edge[] } = {}
): EntitySnapshot {
	const id = o.id ?? 7557;
	return {
		entity: {
			type: 'Shot',
			id,
			name: o.name ?? (id === 7557 ? 'sh010' : `sh${id}`),
			entityType: 'Shot',
			taskTemplate: o.taskTemplate ? { type: 'TaskTemplate', id: o.taskTemplate } : null
		},
		tasks: tasks.map((t) => ({ ...t, entity: { type: 'Shot', id } })),
		edges: o.edges ?? [],
		usage: o.usage ?? {},
		readAt: '2026-09-24T10:00:00Z'
	};
}

// shot-before of recipe 015: roto@CharFX -> tt1 roto, comp@Animation -> tt1 comp, paint@FX hand-made, ip.
const before = () => [
	task(47295, 'roto', 12, { link: 47102, linkTemplate: 201 }),
	task(47296, 'comp', 11, { link: 47101, linkTemplate: 201 }),
	task(47297, 'paint', 14, { status: 'ip' })
];

// Every tt2 task linked; with the template edge and task_template = tt2 this is a noop.
const linked = () => [
	task(1, 'comp', 11, { link: 47201, linkTemplate: 202 }),
	task(2, 'roto', 13, { link: 47202, linkTemplate: 202 }),
	task(3, 'paint', 14, { link: 47203, linkTemplate: 202 })
];

const plan = (s: EntitySnapshot, o: RunOptions = opts, t: Template = tt2) => planEntity(t, s, ctx, o);
const withEdge = (o: RunOptions, id: Id, action: EdgeAction): RunOptions => ({
	...o,
	edgeActions: { ...o.edgeActions, [id]: action }
});

// --- reading the CSV back ---------------------------------------------------------------------

/** Minimal RFC 4180 reader: quotes, doubled quotes, CRLF records, newlines inside quotes. */
function parse(csv: string): string[][] {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < csv.length; i++) {
		const ch = csv[i];
		if (quoted) {
			if (ch === '"' && csv[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ',') {
			record.push(field);
			field = '';
		} else if (ch === '\r' && csv[i + 1] === '\n') {
			record.push(field);
			records.push(record);
			record = [];
			field = '';
			i++;
		} else field += ch;
	}
	return records;
}

type Col = (typeof PLAN_CSV_COLUMNS)[number];
type Line = Record<Col, string>;

function lines(plans: EntityPlan[], template: Template = tt2, labels?: Record<string, string>, o?: RunOptions): Line[] {
	const csv = planToCsv(plans, template, labels, o);
	const [header, ...body] = parse(csv.slice(1));
	expect(header).toEqual(PLAN_CSV_COLUMNS.map((c) => PLAN_CSV_HEADERS[c]));
	return body.map((cells) => {
		expect(cells).toHaveLength(PLAN_CSV_COLUMNS.length);
		return Object.fromEntries(PLAN_CSV_COLUMNS.map((c, i) => [c, cells[i]])) as Line;
	});
}

/** The Outcome cell for each row kind, in the app's words. */
const A: Record<string, string> = {
	apply: 'Apply',
	noop: 'Nothing to write',
	keep: 'Already linked',
	claim: 'Linked',
	create: 'Created',
	extra: 'Not in template',
	conflict: 'Needs a choice',
	'edge-add': 'Dependency added',
	'edge-replace': 'Dependency replaced',
	'edge-delete': 'Dependency removed',
	'edge-outside': 'Dependency on a Task outside the template'
};

const byAction = (ls: Line[], action: string) => ls.filter((l) => l.action === A[action]);
const one = (ls: Line[], action: string) => {
	const found = byAction(ls, action);
	expect(found).toHaveLength(1);
	return found[0];
};

// --- tests ------------------------------------------------------------------------------------

describe('planToCsv: format', () => {
	it('has 14 columns', () => {
		expect(PLAN_CSV_COLUMNS).toHaveLength(14);
	});

	it('starts with a UTF-8 BOM, uses CRLF and ends with one', () => {
		const csv = planToCsv([], tt2);
		expect(csv.charCodeAt(0)).toBe(0xfeff);
		expect(csv.slice(1)).toBe(`${PLAN_CSV_COLUMNS.map((c) => PLAN_CSV_HEADERS[c]).join(',')}\r\n`);
	});

	it('quotes commas, quotes and newlines, and prints values as they are (no formula guard)', () => {
		const ls = lines([plan(snap([task(9, '=SUM(A1), "x"\nnext', 11)], { name: '-sh010' }))]);
		expect(one(ls, 'extra').task).toBe('=SUM(A1), "x"\nnext #9');
		expect(ls[0].entity).toBe('Shot -sh010 #7557');
	});
});

describe('planToCsv: entity row', () => {
	it('opens each entity with an apply row carrying the five counts', () => {
		const ls = lines([plan(snap(before(), { taskTemplate: 201 }))]);
		expect(ls[0].action).toBe('Apply');
		expect(ls[0].template_task).toBe('tt2 #202');
		expect(ls[0].reason).toBe('Already linked 0, Linked 2, Created 1, Not in template 1, Needs a choice 0');
	});

	it('marks a real noop entity noop, with its rows still listed', () => {
		const p = plan(snap(linked(), { taskTemplate: 202, edges: [edge(77, 1, 3)] }));
		expect(p.noop).toBe(true);
		const ls = lines([p]);
		expect(ls[0].action).toBe('Nothing to write');
		expect(byAction(ls, 'keep')).toHaveLength(3);
	});

	it('never writes a row with a blank action', () => {
		const empty: Template = { ...tt2, tasks: [], edges: [] };
		const ls = lines([plan(snap([]), opts, empty), plan(snap(before(), { id: 7558 }), opts, empty)], empty);
		expect(ls.every((l) => l.action !== '')).toBe(true);
		expect(ls[0].action).toBe('Apply');
	});

	it('names the clear-then-set write when task_template already equals the template', () => {
		const ls = lines([plan(snap(linked(), { taskTemplate: 202 }))]);
		expect(ls[0].action).toBe('Apply');
		expect(ls[0].reason).toContain('already on tt2');
	});

	it('lists entities in order, each as consecutive rows', () => {
		const ls = lines([plan(snap(before(), { taskTemplate: 201 })), plan(snap(linked(), { id: 7558 }))]);
		const entities = ls.map((l) => l.entity);
		const firstB = entities.indexOf('Shot sh7558 #7558');
		expect(firstB).toBeGreaterThan(0);
		expect(entities.slice(0, firstB).every((e) => e === 'Shot sh010 #7557')).toBe(true);
		expect(entities.slice(firstB).every((e) => e === 'Shot sh7558 #7558')).toBe(true);
	});
});

describe('planToCsv: task rows (recipe 015)', () => {
	const ls = () => lines([plan(snap(before(), { taskTemplate: 201 }))]);

	it('claims with the previous link by id and template', () => {
		const comp = byAction(ls(), 'claim').find((l) => l.task === 'comp #47296')!;
		expect(comp.template_task).toBe('comp #47201');
		expect(comp.key).toBe('comp @ step11');
		expect(comp.reason).toBe('was linked to #47101 (template 201)');
		const paint = byAction(ls(), 'claim').find((l) => l.task === 'paint #47297')!;
		expect(paint.reason).toBe('not linked before, same name and Step');
	});

	it('creates from the template task, with its dates and whether they can be cleared', () => {
		const create = one(ls(), 'create');
		expect(create.task).toBe('roto (new)');
		expect(create.template_task).toBe('roto #47202');
		expect(create.dates).toBe('template dates 2026-03-02 to 2026-03-04; can be cleared');
	});

	it('a created Task with no template dates says only that', () => {
		const t: Template = { ...tt2, tasks: tt2.tasks.map((x) => ({ ...x, startDate: null, dueDate: null })) };
		const ls = lines([plan(snap([task(1, 'comp', 11)]), opts, t)], t);
		expect(byAction(ls, 'create').map((l) => l.dates)).toEqual(['no template dates', 'no template dates']);
	});

	it('says when a created Task cannot have its dates cleared (upstream edge, 097)', () => {
		const t: Template = { ...tt2, edges: [edge(900, 47202, 47201)] };
		const ls = lines([plan(snap([task(1, 'comp', 11)]), opts, t)], t);
		const create = byAction(ls, 'create').find((l) => l.task === 'roto (new)')!;
		expect(create.dates).toBe('template dates 2026-03-02 to 2026-03-04; cannot be cleared (upstream dependency)');
	});

	it('writes an extra with its reason, decision and usage in one cell', () => {
		const p = plan(snap(before(), { taskTemplate: 201, usage: { 47295: { versions: 2, publishedFiles: 1 } } }));
		const extra = one(lines([p]), 'extra');
		expect(extra.task).toBe('roto #47295');
		expect(extra.key).toBe('roto @ step12');
		expect(extra.reason).toBe('not in the template');
		expect(extra.decision).toBe('leave');
		expect(extra.usage).toBe('2 versions, 1 published file');
	});

	it('marks a Task that may move after the added edge (092)', () => {
		const comp = byAction(ls(), 'claim').find((l) => l.task === 'comp #47296')!;
		expect(comp.dates).toBe('may move');
	});

	it('marks a pinned Task that would flag dependency_violation (092)', () => {
		const tasks = before().map((t) => (t.id === 47296 ? { ...t, pinned: true } : t));
		const comp = byAction(lines([plan(snap(tasks, { taskTemplate: 201 }))]), 'claim').find(
			(l) => l.task === 'comp #47296'
		)!;
		expect(comp.dates).toBe('pinned: would flag a dependency violation');
	});
});

describe('planToCsv: keep rows, field changes and renames', () => {
	it('flags keyMismatch on a keep row and shows a hand rename once', () => {
		const ls = lines([plan(snap([task(1, 'Comp v2', 12, { link: 47201, linkTemplate: 202 })]))]);
		const keep = one(ls, 'keep');
		expect(keep.reason).toBe('linked; name or Step differs');
		expect(keep.warnings).toBe('RENAMED BY HAND: Comp v2 -> comp');
		expect(keep.field_changes).not.toContain('content');
		expect(ls.filter((l) => l.warnings.includes('Comp v2'))).toHaveLength(1);
	});

	it('prints refs by name and each policy readably', () => {
		const t: Template = {
			...tt2,
			tasks: [tt(47201, 'comp', 11, 10, { fields: { sg_description: 'T', est_in_mins: 480 } })],
			edges: []
		};
		const k = task(1, 'comp', 12, { link: 47201, linkTemplate: 202, fields: { sg_description: 'A' } });
		const o: RunOptions = { ...opts, fieldPolicies: { est_in_mins: 'fill_if_empty' } };
		const keep = one(lines([plan(snap([k]), o, t)], t), 'keep');
		expect(keep.field_changes).toBe(
			'step: step12 kept (template: step11); sg_description: A kept (template: T); est_in_mins: ∅ -> 480 (filled if empty)'
		);
	});

	it('names fields by display name, code name beside it; the code name alone without one', () => {
		const t: Template = {
			...tt2,
			tasks: [tt(47201, 'comp', 11, 10, { fields: { sg_description: 'T', est_in_mins: 480 } })],
			edges: []
		};
		const k = task(1, 'comp', 11, { link: 47201, linkTemplate: 202, fields: { sg_description: 'A' } });
		const keep = one(lines([plan(snap([k]), opts, t)], t, { sg_description: 'Description', est_in_mins: '' }), 'keep');
		expect(keep.field_changes).toBe('Description (sg_description): A kept (template: T); est_in_mins: ∅ kept (template: 480)');
	});

	it('shows re-sync field changes on an extra still linked to the template (conflict loser, 102)', () => {
		const t: Template = {
			...tt2,
			tasks: [tt(47203, 'paint', 14, 30, { fields: { sg_description: 'T' } })],
			edges: []
		};
		const two = [
			task(1, 'paint', 14, { link: 47203, linkTemplate: 202, createdAt: '2026-02-01T00:00:00Z' }),
			task(2, 'paint', 14, { link: 47203, linkTemplate: 202, createdAt: '2026-01-01T00:00:00Z' })
		];
		const extra = one(lines([plan(snap(two), opts, t)], t), 'extra');
		expect(extra.reason).toBe('not picked, unlinked from the template task');
		expect(extra.field_changes).toBe('sg_description: ∅ kept (template: T)');
	});

	it('writes link_wins on a same-key Task when another is linked', () => {
		const ls = lines([plan(snap([...linked(), task(9, 'Paint', 14)], { taskTemplate: 202 }))]);
		expect(one(ls, 'extra').reason).toBe('same name and Step, another Task is linked');
	});
});

describe('planToCsv: conflicts', () => {
	const tasks = () => [...before(), task(47299, 'Paint ', 14, { createdAt: '2026-09-03T09:00:00Z' })];
	const usage = { 47299: { versions: 1, publishedFiles: 0 } };

	it('shows candidates, usage per candidate, and the pick equal to the pre-pick', () => {
		const c = one(lines([plan(snap(tasks(), { usage }))]), 'conflict');
		expect(c.template_task).toBe('paint #47203');
		expect(c.task).toBe('Paint  #47299, paint #47297');
		expect(c.usage).toBe('#47299: 1 version; #47297: none');
		expect(c.reason).toBe('pre-pick: it has Versions or Published Files');
		expect(c.decision).toBe('pick (the pre-pick): Paint  #47299');
	});

	it('a choice made by hand reads as picked, on its row and in the counts', () => {
		const o = withEntityConflictPick(opts, 7557, 47203, 47297);
		const p = plan(snap(tasks(), { usage }), o);
		const ls = lines([p], tt2, undefined, o);
		expect(byAction(ls, 'conflict')).toEqual([]);
		expect(ls.filter((l) => l.action === 'Picked')).toHaveLength(1);
		expect(ls[0].reason).not.toContain('Needs a choice');
		expect(ls[0].reason).toContain('Picked 1');
	});

	it('labels a pick that differs from the pre-pick', () => {
		const c = one(lines([plan(snap(tasks(), { usage }), withConflictPick(opts, 47203, 47297))]), 'conflict');
		expect(c.decision).toBe('pick: paint #47297; pre-pick: Paint  #47299');
	});

	it('reads a null pick as creating a new Task', () => {
		const c = one(lines([plan(snap(tasks(), { usage }), withConflictPick(opts, 47203, null))]), 'conflict');
		expect(c.decision).toBe('pick: create a new Task; pre-pick: Paint  #47299');
	});

	it('writes one conflict row per template task when the template has several of one key (Q-E)', () => {
		const t: Template = {
			...tt2,
			tasks: [tt(11, 'Comp', 13, 10), tt(10, 'comp', 13, 20), tt(12, 'comp', 13, 30)],
			edges: []
		};
		const s = snap([task(1, 'comp', 13), task(2, 'comp', 13, { createdAt: '2026-09-03T00:00:00Z' })]);
		const o = withConflictPick(withConflictPick(opts, 10, null), 12, 2);
		const ls = lines([plan(s, o, t)], t);
		const rows = byAction(ls, 'conflict');
		expect(rows.map((r) => r.template_task)).toEqual(['Comp #11', 'comp #10', 'comp #12']);
		expect(rows.map((r) => r.decision)).toEqual([
			'pick (the pre-pick): comp #1',
			'pick: create a new Task; pre-pick: comp #2',
			'pick: comp #2; pre-pick: create a new Task'
		]);
		// The duplicate-key warning prints once, on the first conflict row, not on resolved rows.
		const hits = ls.filter((l) => l.warnings.includes('template has 3 tasks named comp @ step13'));
		expect(hits).toEqual([rows[0]]);
	});
});

describe('planToCsv: warnings', () => {
	it('prints a delete with usage once, on the extra row', () => {
		const o = withExtraOverride(opts, 47295, 'delete');
		const p = plan(snap(before(), { taskTemplate: 201, usage: { 47295: { versions: 2, publishedFiles: 0 } } }), o);
		const hits = lines([p]).filter((l) => l.warnings.includes('delete with'));
		expect(hits).toHaveLength(1);
		expect(hits[0].action).toBe(A.extra);
		expect(hits[0].warnings).toBe('delete with 2 versions, 0 published files');
	});

	it('puts entity-level warnings on the entity row only', () => {
		const t: Template = { ...tt2, entityType: 'Asset' };
		const ls = lines([plan(snap(before(), { taskTemplate: 201 }), opts, t)], t);
		expect(ls[0].warnings).toBe('template is for Asset, entity is Shot');
		expect(ls.filter((l) => l.warnings !== '')).toHaveLength(1);
	});

	it('prints a kept edge that would close a loop on its edge row (085, 107)', () => {
		// tt2 adds comp(1) on paint(3). Site: roto(2) on comp(1), paint(3) on roto(2): 3 -> 1 -> 2 -> 3.
		const a = edge(6, 2, 1, 'finish-to-start-next-day', null);
		const b = edge(7, 3, 2, 'finish-to-start-next-day', null);
		const ls = lines([plan(snap(linked(), { taskTemplate: 202, edges: [a, b] }))]);
		const hits = ls.filter((l) => l.warnings !== '');
		expect(hits).toHaveLength(1);
		expect(hits[0].action).toBe(A['edge-delete']);
		expect(hits[0].edge_upstream).toBe('roto #2');
		expect(hits[0].decision).toBe('removed');
		expect(hits[0].reason).toContain('keeping it would close a loop');
		expect(hits[0].warnings).toBe('dependency #7 would close a loop: removed');
	});
});

describe('planToCsv: edges', () => {
	it('writes an added template edge with its direction', () => {
		const e = one(lines([plan(snap(before(), { taskTemplate: 201 }))]), 'edge-add');
		expect(e.edge_upstream).toBe('paint #47297');
		expect(e.edge_downstream).toBe('comp #47296');
		expect(e.edge_spec).toBe('start-to-start, offset 1');
		expect(e.reason).toBe('from the template');
		expect(e.decision).toBe('');
	});

	it('names a created end as new', () => {
		const t: Template = { ...tt2, edges: [edge(900, 47202, 47201)] };
		const e = one(lines([plan(snap([task(1, 'comp', 11)]), opts, t)], t), 'edge-add');
		expect(e.edge_upstream).toBe('comp #1');
		expect(e.edge_downstream).toBe('roto (new)');
	});

	it('writes a replaced edge once, with old and new spec and its decision', () => {
		const ls = lines([plan(snap(linked(), { edges: [edge(501, 1, 3, 'finish-to-finish', 0)] }))]);
		expect(byAction(ls, 'edge-add')).toHaveLength(0);
		const e = one(ls, 'edge-replace');
		expect(e.edge_upstream).toBe('paint #3');
		expect(e.edge_downstream).toBe('comp #1');
		expect(e.edge_spec).toBe('finish-to-finish, offset 0 -> start-to-start, offset 1');
		expect(e.reason).toBe("replaced by the template's dependency");
		expect(e.decision).toBe('re-created');
	});

	it('says when the template edge runs the other way', () => {
		const s = snap(linked(), { edges: [edge(501, 3, 1)] });
		const ls = lines([plan(s, withEdge(opts, 501, 'remove'))]);
		expect(byAction(ls, 'edge-add')).toHaveLength(0); // the surviving template edge: same pair, one row
		const e = one(ls, 'edge-replace');
		expect(e.edge_upstream).toBe('comp #1');
		expect(e.edge_downstream).toBe('paint #3');
		expect(e.reason).toBe("replaced by the template's dependency, reversed");
		expect(e.decision).toBe('removed');
	});

	it('writes an edge the template lacks between linked Tasks, keep by default', () => {
		const s = snap(linked(), { edges: [edge(77, 1, 3), edge(502, 2, 1, 'finish-to-start-next-day', null)] });
		const e = one(lines([plan(s)]), 'edge-delete');
		expect(e.edge_upstream).toBe('comp #1');
		expect(e.edge_downstream).toBe('roto #2');
		expect(e.edge_spec).toBe('finish-to-start-next-day, offset none');
		expect(e.reason).toBe('not in the template: the apply removes it');
		expect(e.decision).toBe('re-created');
	});

	describe('edges to a Task outside the template', () => {
		const tasks = () => [...linked(), task(9, 'cleanup', 14)];

		it('an outside upstream edge is erased by the apply (109)', () => {
			const s = snap(tasks(), { edges: [edge(77, 1, 3), edge(503, 1, 9)] });
			const e = one(lines([plan(s)]), 'edge-outside');
			expect(e.edge_upstream).toBe('cleanup #9');
			expect(e.edge_downstream).toBe('comp #1');
			expect(e.reason).toBe('upstream Task outside the template: the apply removes it');
			expect(e.decision).toBe('re-created');
			const removed = one(lines([plan(s, withEdge(opts, 503, 'remove'))]), 'edge-outside');
			expect(removed.decision).toBe('removed');
		});

		it('a conflict loser is outside once unlinked (106, 109)', () => {
			const two = [
				task(1, 'comp', 11, { link: 47201, linkTemplate: 202 }),
				task(2, 'comp', 11, { link: 47201, linkTemplate: 202, createdAt: '2026-09-03T00:00:00Z' }),
				task(3, 'paint', 14, { link: 47203, linkTemplate: 202 })
			];
			const s = snap(two, { edges: [edge(77, 1, 3), edge(506, 3, 2)] });
			const ls = lines([plan(s)]);
			expect(one(ls, 'extra').reason).toBe('not picked, unlinked from the template task');
			const e = one(ls, 'edge-outside');
			expect(e.edge_upstream).toBe('comp #2');
			expect(e.reason).toBe('upstream Task outside the template: the apply removes it');
		});

		it('an outside downstream edge is kept', () => {
			const s = snap(tasks(), { edges: [edge(77, 1, 3), edge(504, 9, 1)] });
			expect(one(lines([plan(s)]), 'edge-outside').reason).toBe('downstream Task outside the template: kept');
		});

		it('an extra that is deleted takes its edges, either direction, never re-created (103)', () => {
			const s = snap(tasks(), { edges: [edge(77, 1, 3), edge(504, 9, 1), edge(503, 1, 9)] });
			const ls = lines([plan(s, withEdge(withExtraOverride(opts, 9, 'delete'), 503, 'keep'))]);
			expect(byAction(ls, 'edge-outside')).toEqual([]);
			const gone = byAction(ls, 'edge-delete');
			expect(gone.map((l) => [l.edge_downstream, l.edge_upstream])).toEqual([
				['cleanup #9', 'comp #1'],
				['comp #1', 'cleanup #9']
			]);
			for (const e of gone) {
				expect(e.reason).toBe('removed with cleanup #9, which is deleted');
				expect(e.decision).toBe('');
			}
		});

		it('names a Task of another entity by id', () => {
			const s = snap(linked(), { edges: [edge(77, 1, 3), edge(505, 8000, 2)] });
			const e = one(lines([plan(s)]), 'edge-outside');
			expect(e.edge_downstream).toBe('#8000');
			expect(e.edge_upstream).toBe('roto #2');
		});
	});
});
