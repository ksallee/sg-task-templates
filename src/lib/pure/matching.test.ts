import { describe, expect, it } from 'vitest';
import {
	candidatesFor,
	keyParts,
	matchEntity,
	matchKey,
	normalizeContent,
	prePick
} from './matching';
import type { EntityTask, Id, Template, TemplateTask, TaskUsage } from './types';

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
	opts: { link?: Id | null; linkTemplate?: Id | null; status?: string | null; createdAt?: string } = {}
): EntityTask {
	return {
		...core(id, content, stepId),
		status: opts.status === undefined ? 'wtg' : opts.status,
		entity: { type: 'Shot', id: 7557, name: 'sh010' },
		templateTask: opts.link ? { id: opts.link, templateId: opts.linkTemplate ?? null } : null,
		pinned: false,
		dependencyViolation: false,
		createdAt: opts.createdAt ?? '2026-09-02T15:58:21Z'
	};
}

// tt2 of recipe 015: comp@Animation, roto@Comp, paint@FX.
const tt2: Template = {
	id: 202,
	code: 'tt2',
	entityType: 'Shot',
	tasks: [tt(47201, 'comp', 11, 10), tt(47202, 'roto', 13, 20), tt(47203, 'paint', 14, 30)],
	edges: []
};

// shot-before of recipe 015: roto@CharFX -> tt1 roto, comp@Animation -> tt1 comp, paint@FX hand-made, ip.
const before = [
	task(47295, 'roto', 12, { link: 47102, linkTemplate: 201 }),
	task(47296, 'comp', 11, { link: 47101, linkTemplate: 201 }),
	task(47297, 'paint', 14, { status: 'ip', createdAt: '2026-09-02T16:01:53Z' })
];

describe('normalizeContent', () => {
	it('trims and casefolds', () => {
		expect(normalizeContent('  LAYOUT ')).toBe('layout');
	});
	it('collapses inner whitespace runs to one space (Q-D)', () => {
		expect(normalizeContent('Client  \t Review')).toBe('client review');
		expect(normalizeContent('Client Review')).toBe('client review');
	});
	it('applies NFC', () => {
		expect(normalizeContent('Café')).toBe(normalizeContent('Café'));
	});
	it('maps null to empty', () => {
		expect(normalizeContent(null)).toBe('');
	});
});

describe('matchKey', () => {
	it('differs by step id', () => {
		expect(matchKey('comp', 11)).not.toBe(matchKey('comp', 13));
	});
	it('treats a null step as its own step', () => {
		expect(matchKey('brief', null)).not.toBe(matchKey('brief', 0));
		expect(matchKey(' Brief', null)).toBe(matchKey('brief', null));
	});
	it('round-trips through keyParts', () => {
		expect(keyParts(matchKey(' Client  Review ', 13))).toEqual({ content: 'client review', stepId: 13 });
		expect(keyParts(matchKey(null, null))).toEqual({ content: '', stepId: null });
	});
	it('keeps a content holding the separator apart from the step', () => {
		expect(keyParts(matchKey('a|13', 11))).toEqual({ content: 'a|13', stepId: 11 });
	});
});

describe('candidatesFor', () => {
	it('finds a same-key hand-made task', () => {
		expect(candidatesFor(tt2, before).get(47203)?.map((t) => t.id)).toEqual([47297]);
	});
	it("finds a task linked to another template's task", () => {
		expect(candidatesFor(tt2, before).get(47201)?.map((t) => t.id)).toEqual([47296]);
	});
	it('keeps a linked task under its template task when renamed', () => {
		const tasks = [task(47296, 'Comp v2', 11, { link: 47201, linkTemplate: 202 })];
		expect(candidatesFor(tt2, tasks).get(47201)?.map((t) => t.id)).toEqual([47296]);
	});
	it('ignores same content at another step', () => {
		expect(candidatesFor(tt2, before).get(47202)).toEqual([]);
	});
	it('does not offer a task linked to one template task to another', () => {
		const tpl: Template = { ...tt2, tasks: [...tt2.tasks, tt(47204, 'paint v2', 14, 40)] };
		const tasks = [task(1, 'paint v2', 14, { link: 47203, linkTemplate: 202 })];
		const c = candidatesFor(tpl, tasks);
		expect(c.get(47203)?.map((t) => t.id)).toEqual([1]);
		expect(c.get(47204)).toEqual([]);
	});
});

describe('prePick', () => {
	const none: Record<Id, TaskUsage> = {};
	it('prefers a task with versions', () => {
		const a = task(1, 'comp', 13, { createdAt: '2026-01-05T00:00:00Z' });
		const b = task(2, 'comp', 13, { createdAt: '2026-02-05T00:00:00Z' });
		expect(prePick([a, b], { 2: { versions: 1, publishedFiles: 0 } }, 'wtg')).toMatchObject({
			pick: 2,
			reason: 'usage'
		});
	});
	it('prefers a task with published files', () => {
		const a = task(1, 'comp', 13);
		const b = task(2, 'comp', 13);
		expect(prePick([a, b], { 2: { versions: 0, publishedFiles: 1 } }, 'wtg').pick).toBe(2);
	});
	it('prefers usage over status (S09)', () => {
		const a = task(1, 'comp', 13, { status: 'ip', createdAt: '2026-01-05T00:00:00Z' });
		const b = task(2, 'comp', 13, { createdAt: '2026-02-05T00:00:00Z' });
		expect(prePick([a, b], { 2: { versions: 1, publishedFiles: 0 } }, 'wtg')).toMatchObject({
			pick: 2,
			reason: 'usage'
		});
	});
	it('prefers a non-default status when usage ties (S07)', () => {
		const a = task(1, 'comp', 13, { createdAt: '2026-01-05T00:00:00Z' });
		const b = task(2, 'comp', 13, { status: 'ip', createdAt: '2026-02-05T00:00:00Z' });
		expect(prePick([a, b], none, 'wtg')).toMatchObject({ pick: 2, reason: 'status' });
	});
	it('does not count a null status as worked on', () => {
		const a = task(1, 'comp', 13, { createdAt: '2026-01-05T00:00:00Z' });
		const b = task(2, 'comp', 13, { status: null, createdAt: '2026-02-05T00:00:00Z' });
		expect(prePick([a, b], none, 'wtg')).toMatchObject({ pick: 1, reason: 'oldest' });
	});
	it('prefers the oldest when status ties, not the lowest id (S08)', () => {
		const t1 = task(1, 'comp', 13, { createdAt: '2026-03-05T00:00:00Z' });
		const t2 = task(2, 'comp', 13, { createdAt: '2026-01-05T00:00:00Z' });
		const t3 = task(3, 'comp', 13, { createdAt: '2026-02-05T00:00:00Z' });
		const r = prePick([t1, t2, t3], none, 'wtg');
		expect(r).toMatchObject({ pick: 2, reason: 'oldest' });
		expect(r.order.map((t) => t.id)).toEqual([2, 3, 1]);
	});
	it('breaks a created_at tie by id', () => {
		const a = task(9, 'comp', 13);
		const b = task(4, 'comp', 13);
		expect(prePick([a, b], none, 'wtg')).toMatchObject({ pick: 4, reason: 'id' });
	});
	it('reports only for a single candidate', () => {
		expect(prePick([task(4, 'comp', 13)], none, 'wtg')).toMatchObject({ pick: 4, reason: 'only' });
	});
	it('throws on no candidate', () => {
		expect(() => prePick([], none, 'wtg')).toThrow();
	});
});

describe('matchEntity', () => {
	it('matches recipe 015: two claims, one create, one extra', () => {
		const m = matchEntity(tt2, before, {}, 'wtg');
		expect(m.keep).toEqual([]);
		expect(m.claim).toEqual([
			{ templateTaskId: 47201, taskId: 47296 },
			{ templateTaskId: 47203, taskId: 47297 }
		]);
		expect(m.create).toEqual([47202]);
		expect(m.extra).toEqual([{ taskId: 47295, reason: 'not_in_template' }]);
		expect(m.conflict).toEqual([]);
	});

	it('keeps a task linked to this template, flagging a renamed one', () => {
		const tasks = [
			task(47296, 'Comp v2', 11, { link: 47201, linkTemplate: 202 }),
			task(47297, 'paint', 14, { link: 47203, linkTemplate: 202 })
		];
		const m = matchEntity(tt2, tasks, {}, 'wtg');
		expect(m.keep).toEqual([
			{ templateTaskId: 47201, taskId: 47296, keyMismatch: true },
			{ templateTaskId: 47203, taskId: 47297, keyMismatch: false }
		]);
		expect(m.create).toEqual([47202]);
	});

	it('detects a link without the template id on the Task (S05)', () => {
		const tasks = [task(47296, 'comp', 11, { link: 47201, linkTemplate: null })];
		expect(matchEntity(tt2, tasks, {}, 'wtg').keep).toHaveLength(1);
	});

	it('lets a link win: the other same-key task is an extra, no conflict', () => {
		const tasks = [
			task(1, 'paint', 14, { link: 47203, linkTemplate: 202 }),
			task(2, 'Paint ', 14, { status: 'ip' })
		];
		const m = matchEntity(tt2, tasks, { 2: { versions: 3, publishedFiles: 0 } }, 'wtg');
		expect(m.keep).toEqual([{ templateTaskId: 47203, taskId: 1, keyMismatch: false }]);
		expect(m.extra).toEqual([{ taskId: 2, reason: 'link_wins' }]);
		expect(m.conflict).toEqual([]);
	});

	it('raises a conflict for two same-key tasks, pre-picked by usage (conflict-paint)', () => {
		const tasks = [...before, task(47299, 'Paint ', 14, { createdAt: '2026-09-03T09:00:00Z' })];
		const m = matchEntity(tt2, tasks, { 47299: { versions: 1, publishedFiles: 0 } }, 'wtg');
		expect(m.claim).toEqual([{ templateTaskId: 47201, taskId: 47296 }]);
		expect(m.conflict).toEqual([
			{
				key: matchKey('paint', 14),
				templateTaskIds: [47203],
				candidates: [47299, 47297],
				prePick: { 47203: 47299 },
				reason: 'usage'
			}
		]);
	});

	it('counts a task linked to another template as a plain candidate (S10)', () => {
		const tasks = [
			task(47296, 'comp', 11, { link: 47101, linkTemplate: 201, createdAt: '2026-02-01T00:00:00Z' }),
			task(5, 'comp ', 11, { status: 'ip', createdAt: '2026-01-05T00:00:00Z' })
		];
		const m = matchEntity(tt2, tasks, {}, 'wtg');
		expect(m.conflict).toHaveLength(1);
		expect(m.conflict[0]).toMatchObject({ candidates: [5, 47296], prePick: { 47201: 5 }, reason: 'status' });
	});

	it('raises a conflict for a template with two tasks of one key (Q-E)', () => {
		const tpl: Template = { ...tt2, tasks: [tt(10, 'comp', 13, 20), tt(11, 'Comp', 13, 10)] };
		const m = matchEntity(tpl, [task(1, 'comp', 13)], {}, 'wtg');
		expect(m.claim).toEqual([]);
		expect(m.create).toEqual([]);
		expect(m.conflict).toEqual([
			{
				key: matchKey('comp', 13),
				templateTaskIds: [11, 10],
				candidates: [1],
				prePick: { 11: 1 },
				reason: 'only'
			}
		]);
	});

	it('creates both tasks of a duplicated template key when nothing matches', () => {
		const tpl: Template = { ...tt2, tasks: [tt(10, 'comp', 13, 10), tt(11, 'comp', 13, 20)] };
		const m = matchEntity(tpl, [], {}, 'wtg');
		expect(m.create).toEqual([10, 11]);
		expect(m.conflict).toEqual([]);
	});

	it('claims the one free task when the other duplicated template task is linked', () => {
		const tpl: Template = { ...tt2, tasks: [tt(10, 'comp', 13, 10), tt(11, 'comp', 13, 20)] };
		const tasks = [task(1, 'comp', 13, { link: 10, linkTemplate: 202 }), task(2, 'comp', 13)];
		const m = matchEntity(tpl, tasks, {}, 'wtg');
		expect(m.keep).toEqual([{ templateTaskId: 10, taskId: 1, keyMismatch: false }]);
		expect(m.claim).toEqual([{ templateTaskId: 11, taskId: 2 }]);
		expect(m.extra).toEqual([]);
	});

	it('raises a conflict when two tasks link to one template task', () => {
		const tasks = [
			task(1, 'paint', 14, { link: 47203, linkTemplate: 202, createdAt: '2026-02-01T00:00:00Z' }),
			task(2, 'paint', 14, { link: 47203, linkTemplate: 202, createdAt: '2026-01-01T00:00:00Z' })
		];
		const m = matchEntity(tt2, tasks, {}, 'wtg');
		expect(m.keep).toEqual([]);
		expect(m.conflict).toEqual([
			{
				key: matchKey('paint', 14),
				templateTaskIds: [47203],
				candidates: [2, 1],
				prePick: { 47203: 2 },
				reason: 'oldest'
			}
		]);
	});

	it('matches a null step only to a null step (S03, S18)', () => {
		const tpl: Template = { ...tt2, tasks: [tt(10, 'Brief', null, 10), tt(11, 'Layout', 20, 20)] };
		const tasks = [task(1, 'brief', null), task(2, 'Layout', null)];
		const m = matchEntity(tpl, tasks, {}, 'wtg');
		expect(m.claim).toEqual([{ templateTaskId: 10, taskId: 1 }]);
		expect(m.create).toEqual([11]);
		expect(m.extra).toEqual([{ taskId: 2, reason: 'not_in_template' }]);
	});

	it('normalizes case and whitespace (S02)', () => {
		const tpl: Template = { ...tt2, tasks: [tt(10, 'Client Review', 13, 10), tt(11, 'Layout', 20, 20)] };
		const tasks = [task(1, 'Client  Review', 13), task(2, ' LAYOUT', 20)];
		expect(matchEntity(tpl, tasks, {}, 'wtg').claim).toEqual([
			{ templateTaskId: 10, taskId: 1 },
			{ templateTaskId: 11, taskId: 2 }
		]);
	});
});
