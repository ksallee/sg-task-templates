/**
 * Columns: what the entities table shows before the user picks, and where the pick is kept. Pure, no I/O.
 */

import type { ColumnSpec } from 'sg-widgets-core';

/**
 * The columns every type starts with, in order. `image` is the row's thumbnail as a presigned URL on the
 * same read (081). `tasks` is the type's Task link list, read on the same `_search`, drawn as its count.
 */
const COMMON: ColumnSpec[] = [
	{ path: 'image', width: 100, sortable: false, editable: false },
	{ path: 'code', width: 220, editable: false },
	{ path: 'description', width: 280, editable: false },
	{ path: 'sg_status_list', width: 170, editable: false },
	{ path: 'task_template', width: 200, editable: false }
];

/** The fields a type is picked by beyond the common ones. */
const BY_TYPE: Record<string, ColumnSpec[]> = {
	Shot: [{ path: 'sg_sequence', width: 160, editable: false }],
	Asset: [{ path: 'sg_asset_type', width: 140, editable: false }]
};

const TASK_COUNT: ColumnSpec = { path: 'tasks', header: 'Tasks', width: 90, align: 'right', sortable: false, editable: false };

/** The default columns of `entityType`, keeping only the fields its schema has. */
export function defaultColumns(entityType: string, fields: Record<string, unknown>): ColumnSpec[] {
	return [...COMMON, ...(BY_TYPE[entityType] ?? []), TASK_COUNT].filter((spec) => spec.path in fields);
}

/** How many links a `tasks` value holds. Null when the value is not a link list. */
export function taskCount(value: unknown): number | null {
	return Array.isArray(value) ? value.length : null;
}

/** Where the user's column pick is kept: per project and type. */
export function columnsKeyFor(projectId: number, entityType: string): string {
	return `sg-task-templates:columns:${projectId}:${entityType}`;
}
