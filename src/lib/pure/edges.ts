/**
 * Edges: what a template apply does to an entity's TaskDependency rows, and which Tasks that may
 * reschedule. Pure, no I/O.
 *
 * Writing `task_template` = T reconciles T's edges against every Task linked to T (099, 102):
 *   - a template edge missing on a mapped pair is added, whichever of keep, claim or create the
 *     ends are (092, 099);
 *   - an edge on that pair of another type, offset or direction is erased and T's written in its
 *     place (101, 102);
 *   - an edge between two linked Tasks that T lacks either way is deleted (102);
 *   - an edge where a linked Task depends on a Task not linked to T (an extra, a conflict loser, a
 *     Task linked to another template, a Task on another entity) is erased (109);
 *   - an edge where the Task not linked to T is downstream is kept (101 control, 102, 109).
 * "Linked" is after the claims: conflict losers are unlinked before the template write (106), so
 * they are outside Tasks here. Offsets compare strictly: null and 0 differ to the server (105).
 * Deleted, replaced and outside-upstream edges carry keep (default) / remove (decisions). Keep
 * re-creates the old edge after the apply, in the same batch; for a replaced edge it first deletes
 * the template's copy, since a pair holds one row and a two-Task loop is a 400 (085). That copy is
 * listed in `transientAdded`, not `expectedAdded`, which holds only edges that survive the run.
 * A kept edge whose re-creation would close a loop of any length is refused by the server (085,
 * 107) and rolls the whole batch back: it is marked `closesLoop` and defaults to remove.
 *
 * An edge with an end on a Task the batch deletes goes with that Task (089, 103), whatever the
 * apply would do to it: listed in `withDeleted`, never kept, and out of the after-apply graph.
 *
 * Date impact is graph level. An edge that comes to exist reschedules its unpinned downstream Task
 * at once and the move cascades (092, 087, 100); a pinned Task holds and flags
 * `dependency_violation` (092). Deleting an edge moves nothing (095). Whether a given Task really
 * moves, and to which dates, needs the placement rules of 085 over the site working week (047):
 * out of scope here, so the lists read "may move" and "would flag", not new dates.
 */

import type {
	AffectedEdge,
	Edge,
	EdgeAction,
	EdgePlan,
	EntityTask,
	Id,
	MappedTask,
	PlanRow,
	Template
} from './types';

/** Template task id -> the Task that stands for it after apply. */
export type TaskMap = Map<Id, MappedTask>;

export interface EdgeInput {
	template: Template;
	/** The entity's Tasks (for `pinned`). */
	tasks: EntityTask[];
	/** The entity's TaskDependency rows. */
	edges: Edge[];
	/** After matching and conflict picks: keep, claim and create. Everything else is an extra. */
	mapping: TaskMap;
	/** By TaskDependency id. Absent = 'keep'. */
	edgeActions?: Record<Id, EdgeAction>;
	/** Tasks the batch deletes (extras set to delete): their edges go with them. */
	deleted?: Id[];
}

/** Keep, claim and create rows, and conflicts by their pick (null = the server creates it). */
export function mapTasks(rows: PlanRow[]): TaskMap {
	const out: TaskMap = new Map();
	for (const row of rows) {
		if (row.kind === 'keep' || row.kind === 'claim') {
			out.set(row.templateTask.id, { existing: row.task.id });
		} else if (row.kind === 'create') {
			out.set(row.templateTask.id, { created: row.templateTask.id });
		} else if (row.kind === 'conflict') {
			for (const tt of row.templateTasks) {
				if (!(tt.id in row.pick)) continue;
				const pick = row.pick[tt.id];
				out.set(tt.id, pick === null ? { created: tt.id } : { existing: pick });
			}
		}
	}
	return out;
}

// A node of the after-apply graph: an existing Task or a Task the server creates.
type Node = string;
const nodeOf = (m: MappedTask): Node => ('existing' in m ? `t${m.existing}` : `c${m.created}`);
const taskNode = (id: Id): Node => `t${id}`;
const pairKey = (a: Node, b: Node) => (a < b ? `${a}|${b}` : `${b}|${a}`);

interface GraphEdge {
	down: Node;
	up: Node;
}

function sameSpec(a: Edge, b: Edge): boolean {
	// Offsets compare strictly: null and 0 are different edges to the server (105).
	return a.type === b.type && a.offsetDays === b.offsetDays;
}

export function planEdges(input: EdgeInput): EdgePlan {
	const { template, tasks, edges, mapping } = input;
	const actions = input.edgeActions ?? {};
	const deleted = new Set(input.deleted ?? []);

	const mappedExisting = new Set<Id>();
	for (const m of mapping.values()) if ('existing' in m) mappedExisting.add(m.existing);

	// Template edges on mapped pairs, by unordered pair.
	const templateOnPair = new Map<string, { edge: Edge; down: MappedTask; up: MappedTask }>();
	for (const te of template.edges) {
		const down = mapping.get(te.downstream);
		const up = mapping.get(te.upstream);
		if (!down || !up) continue;
		templateOnPair.set(pairKey(nodeOf(down), nodeOf(up)), { edge: te, down, up });
	}

	const plan: EdgePlan = {
		expectedAdded: [],
		transientAdded: [],
		affected: [],
		toExtras: [],
		mayMove: [],
		wouldViolate: [],
		untouched: [],
		withDeleted: []
	};
	const standing: GraphEdge[] = []; // existing edges the apply keeps
	const satisfied = new Set<string>(); // pairs already holding the template's edge
	const created: GraphEdge[] = []; // edges that come to exist: sources of date impact
	// Affected edges with what the loop check needs: graph edge, replaced pair, explicit action.
	const pending: Array<{ a: AffectedEdge; g: GraphEdge; pair: string | null; explicit: boolean }> = [];

	for (const edge of edges) {
		const gone = deleted.has(edge.upstream) ? edge.upstream : deleted.has(edge.downstream) ? edge.downstream : null;
		if (gone !== null && edge.id !== null) {
			plan.withDeleted!.push({ edge: edge as Edge & { id: Id }, task: gone });
			continue;
		}
		const down = mappedExisting.has(edge.downstream);
		const up = mappedExisting.has(edge.upstream);
		const g = { down: taskNode(edge.downstream), up: taskNode(edge.upstream) };
		if (!down && !up) {
			plan.untouched!.push(edge);
			standing.push(g);
			continue;
		}
		if (!down) {
			// The outside Task is downstream: the apply keeps the edge (101, 109).
			plan.toExtras.push(edge);
			standing.push(g);
			continue;
		}
		const explicit = edge.id !== null ? actions[edge.id] : undefined;
		const action = explicit ?? 'keep';
		const existing = edge as Edge & { id: Id };
		if (!up) {
			// A linked Task depends on an outside Task: the apply erases the edge (109).
			const a: AffectedEdge = { existing, cause: 'outside_upstream', replacedBy: null, action };
			pending.push({ a, g, pair: null, explicit: explicit !== undefined });
			continue;
		}
		const key = pairKey(g.down, g.up);
		const tpl = templateOnPair.get(key);
		if (tpl && nodeOf(tpl.down) === g.down && sameSpec(tpl.edge, edge)) {
			satisfied.add(key);
			standing.push(g);
			continue;
		}
		const a: AffectedEdge = {
			existing,
			cause: tpl ? 'replaced' : 'not_in_template',
			replacedBy: tpl ? { ...tpl.edge, id: null, downstream: idOf(tpl.down), upstream: idOf(tpl.up) } : null,
			action
		};
		pending.push({ a, g, pair: tpl ? key : null, explicit: explicit !== undefined });
	}

	// Loop check over the after-apply graph (085: 2 Tasks, 107: 3+ Tasks; either is a 400 that rolls
	// the batch back). Base: edges the apply keeps, plus T's copies that survive the apply's own
	// writes. Kept edges are then re-created in plan order; one that would close a loop is marked and
	// defaults to remove. A replaced edge that falls back to remove lets T's copy stand.
	const keptPair = new Set(pending.filter((p) => p.pair && p.a.action === 'keep').map((p) => p.pair!));
	const graph = new Map<Node, Set<Node>>(); // up -> downs
	const link = (g: GraphEdge) => graph.set(g.up, (graph.get(g.up) ?? new Set()).add(g.down));
	const reaches = (from: Node, to: Node) => {
		const seen = new Set<Node>();
		const stack = [from];
		while (stack.length > 0) {
			const n = stack.pop()!;
			if (n === to) return true;
			if (seen.has(n)) continue;
			seen.add(n);
			stack.push(...(graph.get(n) ?? []));
		}
		return false;
	};
	const tplGraph = (pair: string): GraphEdge => {
		const tpl = templateOnPair.get(pair)!;
		return { down: nodeOf(tpl.down), up: nodeOf(tpl.up) };
	};
	standing.forEach(link);
	for (const pair of templateOnPair.keys()) if (!satisfied.has(pair) && !keptPair.has(pair)) link(tplGraph(pair));
	for (const p of pending) {
		if (p.a.action !== 'keep') continue;
		if (reaches(p.g.down, p.g.up)) {
			p.a.closesLoop = true;
			if (!p.explicit) p.a.action = 'remove';
		}
		if (p.a.action === 'keep') link(p.g);
		else if (p.pair) link(tplGraph(p.pair));
	}

	const templateCopyDropped = new Map<string, Id>(); // pair -> kept edge whose keep deletes the template's copy
	for (const p of pending) {
		plan.affected.push(p.a);
		if (p.a.action !== 'keep') continue;
		created.push(p.g);
		if (p.pair) templateCopyDropped.set(p.pair, p.a.existing.id);
	}

	for (const [key, tpl] of templateOnPair) {
		if (satisfied.has(key)) continue;
		const added = { templateEdge: tpl.edge, downstream: tpl.down, upstream: tpl.up };
		const keptEdge = templateCopyDropped.get(key);
		if (keptEdge !== undefined) {
			plan.transientAdded!.push({ ...added, keptEdge });
			continue;
		}
		plan.expectedAdded.push(added);
		created.push({ down: nodeOf(tpl.down), up: nodeOf(tpl.up) });
	}
	const byTemplateOrder = (a: { templateEdge: Edge }, b: { templateEdge: Edge }) =>
		template.edges.indexOf(a.templateEdge) - template.edges.indexOf(b.templateEdge);
	plan.expectedAdded.sort(byTemplateOrder);
	plan.transientAdded!.sort(byTemplateOrder);

	// Walk down the after-apply graph from each new edge's downstream end.
	const after = [...standing, ...created];
	const below = new Map<Node, Node[]>();
	for (const g of after) below.set(g.up, [...(below.get(g.up) ?? []), g.down]);
	const pinned = new Set(tasks.filter((t) => t.pinned).map((t) => t.id));

	const seen = new Set<Node>();
	const queue = created.map((g) => g.down);
	const mayMove = new Set<Id>();
	const wouldViolate = new Set<Id>();
	while (queue.length > 0) {
		const node = queue.shift()!;
		if (seen.has(node)) continue;
		seen.add(node);
		if (node.startsWith('t')) {
			const id = Number(node.slice(1));
			// A Task outside the snapshot (another entity) has no known pin: listed as may move.
			if (pinned.has(id)) {
				wouldViolate.add(id); // holds its dates: nothing below moves because of it
				continue;
			}
			mayMove.add(id);
		}
		// A created Task is new: never listed, but its move cascades.
		queue.push(...(below.get(node) ?? []));
	}
	plan.mayMove = [...mayMove].sort((a, b) => a - b);
	plan.wouldViolate = [...wouldViolate].sort((a, b) => a - b);
	return plan;
}

function idOf(m: MappedTask): Id {
	return 'existing' in m ? m.existing : m.created;
}

/** Tasks strictly downstream of `start` (start Tasks left out), through `edges`. Stops at cycles. */
export function downstreamClosure(start: Id[], edges: Edge[]): Id[] {
	const below = new Map<Id, Id[]>();
	for (const e of edges) below.set(e.upstream, [...(below.get(e.upstream) ?? []), e.downstream]);
	const seen = new Set<Id>();
	const queue = start.flatMap((id) => below.get(id) ?? []);
	while (queue.length > 0) {
		const id = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		queue.push(...(below.get(id) ?? []));
	}
	for (const id of start) seen.delete(id);
	return [...seen].sort((a, b) => a - b);
}

/** Split Task ids by `pinned` (087). */
export function splitPinned(ids: Id[], tasks: EntityTask[]): { unpinned: Id[]; pinned: Id[] } {
	const pinned = new Set(tasks.filter((t) => t.pinned).map((t) => t.id));
	return { unpinned: ids.filter((id) => !pinned.has(id)), pinned: ids.filter((id) => pinned.has(id)) };
}
