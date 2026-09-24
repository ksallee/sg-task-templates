/**
 * A scripted `SgClient` for the I/O tests: answers each call from a handler and records it. For what
 * `sg-widgets-core/mock`'s MockClient cannot express: it has no TaskTemplate, TaskDependency or
 * PublishedFile type, no `task_template`/`template_task` on Task, no `tracking_settings` on Project,
 * and none of 094's refusals (a bad-status create lands; a rolled-back batch has no `detail`).
 */
import type { EntityRow, SearchOptions, SgClient } from 'sg-widgets-core';

export interface Call {
	method: string;
	args: unknown[];
}

export type Handlers = Partial<{ [K in keyof SgClient]: (...args: Parameters<SgClient[K]>) => unknown }>;

/** `search` answers from `rows[type]`, sliced by the requested page, when no `search` handler is given. */
export function fakeClient(handlers: Handlers, rows: Record<string, EntityRow[]> = {}): { client: SgClient; calls: Call[] } {
	const calls: Call[] = [];
	const search = (type: string, options: SearchOptions) => {
		const size = options.page?.size ?? 50;
		const start = ((options.page?.number ?? 1) - 1) * size;
		const data = (rows[type] ?? []).slice(start, start + size);
		return { data, hasMore: data.length === size };
	};
	const client = new Proxy({} as SgClient, {
		get(_, method: string) {
			return async (...args: unknown[]) => {
				calls.push({ method, args });
				const handler = (handlers as Record<string, (...a: unknown[]) => unknown>)[method];
				if (handler) return handler(...args);
				if (method === 'search') return search(args[0] as string, args[1] as SearchOptions);
				throw new Error(`fakeClient: no handler for ${method}`);
			};
		}
	});
	return { client, calls };
}

/** The `search` calls on one type, as their options. */
export function searches(calls: Call[], type: string): SearchOptions[] {
	return calls.filter((c) => c.method === 'search' && c.args[0] === type).map((c) => c.args[1] as SearchOptions);
}
