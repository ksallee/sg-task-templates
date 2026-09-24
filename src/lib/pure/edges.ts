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
 *
 * Date impact is graph level. An edge that comes to exist reschedules its unpinned downstream Task
 * at once and the move cascades (092, 087, 100); a pinned Task holds and flags
 * `dependency_violation` (092). Deleting an edge moves nothing (095). Whether a given Task really
 * moves, and to which dates, needs the placement rules of 085 over the site working week (047):
 * out of scope here, so the lists read "may move" and "would flag", not new dates.
 */

import type {
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
		untouched: []
	};
	const standing: GraphEdge[] = []; // existing edges the apply keeps
	const satisfied = new Set<string>(); // pairs already holding the template's edge
	const templateCopyDropped = new Map<string, Id>(); // pair -> kept edge whose keep deletes the template's copy
	const created: GraphEdge[] = []; // edges that come to exist: sources of date impact

	for (const edge of edges) {
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
		if (!up) {
			// A linked Task depends on an outside Task: the apply erases the edge (109).
			const action = (edge.id !== null && actions[edge.id]) || 'keep';
			plan.affected.push({ existing: edge as Edge & { id: Id }, cause: 'outside_upstream', replacedBy: null, action });
			if (action === 'keep') created.push(g);
			continue;
		}
		const key = pairKey(g.down, g.up);
		const tpl = templateOnPair.get(key);
		if (tpl && nodeOf(tpl.down) === g.down && sameSpec(tpl.edge, edge)) {
			satisfied.add(key);
			standing.push(g);
			continue;
		}
		const action = (edge.id !== null && actions[edge.id]) || 'keep';
		plan.affected.push({
			existing: edge as Edge & { id: Id },
			cause: tpl ? 'replaced' : 'not_in_template',
			replacedBy: tpl ? { ...tpl.edge, id: null, downstream: idOf(tpl.down), upstream: idOf(tpl.up) } : null,
			action
		});
		if (action === 'keep') {
			created.push(g);
			if (tpl) templateCopyDropped.set(key, edge.id as Id);
		}
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
