/**
 * Result: the post-apply read-back against the plan. Pure, no I/O.
 *
 * Checks that every create happened, every claim landed, every write-back held and the edges came
 * out as planned, and lists what did not as `ResultDifference`s for the result screen and the
 * retry. A batch the client rejected (recipe 002: atomic, nothing in it landed) becomes a failure
 * entry carrying the error's title, not a diff.
 */

import type { EntityRow } from 'sg-widgets-core';
import type {
	BatchRequest,
	BatchResultRow,
	Edge,
	EntityPlan,
	EntityRef,
	EntityResult,
	EntityResultFailed,
	EntityResultOk,
	EntitySnapshot,
	EntityTask,
	Id,
	MappedTask,
	ResultDifference
} from './types';

/** Pair each `_batch` response row with the request at its position (recipe 002: rows are ordered, not keyed). */
export function pairResults(reqs: BatchRequest[], rows: BatchResultRow[]): Array<{ req: BatchRequest; id: Id }> {
	if (rows.length !== reqs.length) throw new Error(`pairResults: ${rows.length} rows for ${reqs.length} requests`);
	return reqs.map((req, i) => {
		const row = rows[i];
		const id = 'data' in row ? (row.data as EntityRow).id : row.id;
		return { req, id };
	});
}

/** Turn a client error (`SgApiError`-shaped: status plus the first error's title as `message`) into a failure entry. */
export function failedEntityResult(entity: EntityRef, error: { status: number | null; message: string }): EntityResultFailed {
	return { kind: 'failed', entity, error: { status: error.status, message: error.message } };
}

function sameValue(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
	return a === b;
}

function byId(tasks: EntityTask[], id: Id): EntityTask | undefined {
	return tasks.find((t) => t.id === id);
}

function sameEdgeEnds(e: Edge, downstream: Id, upstream: Id): boolean {
	return e.downstream === downstream && e.upstream === upstream;
}

/** Ends, type and offset: offset null and 0 are different edges to the server (105). */
function sameEdgeSpec(e: Edge, spec: Edge): boolean {
	return sameEdgeEnds(e, spec.downstream, spec.upstream) && e.type === spec.type && e.offsetDays === spec.offsetDays;
}

function resolveEnd(end: MappedTask, createdByTemplateTaskId: Map<Id, Id>): Id | null {
	return 'existing' in end ? end.existing : (createdByTemplateTaskId.get(end.created) ?? null);
}

/**
 * Compare the read-back after apply to the plan for one entity: which creates happened, which
 * claims landed, which write-backs held, and the edges the plan predicted.
 *
 * Not checked here (out of this module's reach from `EntityPlan` alone): the status an `omit`
 * lands on (the target code lives in `RunOptions.omitStatus`, not on the `ExtraRow`), and edges
 * `toExtras` (information only; the apply is not asked to touch them).
 */
export function diffEntity(
	plan: EntityPlan,
	before: EntitySnapshot,
	after: EntitySnapshot
): { created: Id[]; addedEdges: Array<Edge & { id: Id }>; differences: ResultDifference[] } {
	const differences: ResultDifference[] = [];
	const created: Id[] = [];
	const createdByTemplateTaskId = new Map<Id, Id>();
	const consumed = new Set<Id>();

	const beforeIds = new Set(before.tasks.map((t) => t.id));
	const newTasks = after.tasks.filter((t) => !beforeIds.has(t.id));

	for (const row of plan.rows) {
		if (row.kind === 'create') {
			const task = newTasks.find((t) => t.templateTask?.id === row.templateTask.id);
			if (task) {
				created.push(task.id);
				createdByTemplateTaskId.set(row.templateTask.id, task.id);
				consumed.add(task.id);
			} else {
				differences.push({ code: 'create_missing', templateTaskId: row.templateTask.id });
			}
			continue;
		}

		if (row.kind === 'claim' || row.kind === 'keep') {
			const task = byId(after.tasks, row.task.id);
			if (row.kind === 'claim' && task?.templateTask?.id !== row.templateTask.id) {
				differences.push({ code: 'claim_missing', taskId: row.task.id, templateTaskId: row.templateTask.id });
			}
			for (const change of row.fieldChanges) {
				const actual = task?.fields[change.field];
				if (!sameValue(actual, change.result)) {
					differences.push({
						code: 'writeback_missing',
						taskId: row.task.id,
						field: change.field,
						expected: change.result,
						actual
					});
				}
			}
			continue;
		}

		if (row.kind === 'extra' && row.action === 'delete') {
			if (byId(after.tasks, row.task.id)) differences.push({ code: 'delete_missing', taskId: row.task.id });
			continue;
		}

		// 106: a loser left linked to T's task makes the server pick which Task it re-syncs.
		if (row.kind === 'extra' && row.reason === 'conflict_loser') {
			const link = byId(after.tasks, row.task.id)?.templateTask;
			if (link && link.templateId === plan.templateId) {
				differences.push({ code: 'unlink_missing', taskId: row.task.id, templateTaskId: link.id });
			}
		}
	}

	// A new Task under a template task no `create` row named: the server made it for a claim that
	// did not take, or something outside the plan created it.
	for (const task of newTasks) {
		if (!consumed.has(task.id) && task.templateTask) {
			differences.push({ code: 'create_unexpected', taskId: task.id, templateTaskId: task.templateTask.id });
		}
	}

	const addedEdges: Array<Edge & { id: Id }> = [];
	for (const expected of plan.edges.expectedAdded) {
		const downstream = resolveEnd(expected.downstream, createdByTemplateTaskId);
		const upstream = resolveEnd(expected.upstream, createdByTemplateTaskId);
		const found =
			downstream !== null && upstream !== null
				? after.edges.find(
						(e) =>
							sameEdgeEnds(e, downstream, upstream) &&
							e.type === expected.templateEdge.type &&
							e.offsetDays === expected.templateEdge.offsetDays &&
							e.id !== null
					)
				: undefined;
		if (found?.id != null) addedEdges.push(found as Edge & { id: Id });
		else differences.push({ code: 'edge_expected_missing', downstream: downstream ?? -1, upstream: upstream ?? -1 });
	}

	// Edges the apply erases (101, 102, 107, 109), deleted or replaced by T's: under keep the batch
	// re-creates the old spec (new id), under remove it stays gone. A replaced edge's template
	// successor is checked above, through `expectedAdded`.
	for (const affected of plan.edges.affected) {
		const { downstream, upstream } = affected.existing;
		const stillThere = after.edges.find((e) => sameEdgeSpec(e, affected.existing));
		if (affected.action === 'keep' && !stillThere) {
			differences.push({ code: 'edge_recreate_missing', previousId: affected.existing.id, downstream, upstream });
		} else if (affected.action === 'remove' && stillThere) {
			differences.push({ code: 'edge_still_present', edgeId: stillThere.id ?? affected.existing.id });
		}
	}

	return { created, addedEdges, differences };
}

/** `diffEntity`, wrapped as the `EntityResult` the result screen and the retry read. */
export function resultForEntity(plan: EntityPlan, before: EntitySnapshot, after: EntitySnapshot): EntityResultOk {
	return { kind: 'ok', entity: plan.entity, ...diffEntity(plan, before, after) };
}

export type { EntityResult };
