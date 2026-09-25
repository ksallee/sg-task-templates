/**
 * The step indicator: the six screens in order, each current, done, open or blocked, from a few
 * facts the run holds. Pure, no I/O. The shell (`$lib/app/flow-steps.svelte`) draws it.
 *
 * - current: the screen on show.
 * - done: passed: the site answered, a template is picked, the plan is built, a run started or finished.
 * - open: reachable, not done.
 * - blocked: waits on an earlier screen; `hint` says which.
 */

export type StepId = 'connect' | 'template' | 'entities' | 'plan' | 'apply' | 'result';
export type StepState = 'current' | 'done' | 'open' | 'blocked';

export interface FlowFacts {
	/** The site answered: no `problem` from `prepareLive`. */
	connected: boolean;
	/** Project, entity type and template are picked. */
	templatePicked: boolean;
	/** Entities' Next built the plans. */
	planned: boolean;
	/** An apply started in this tab (or a stored run is on show). */
	runStarted: boolean;
	/** That run is no longer running. */
	runFinished: boolean;
}

export interface FlowStep {
	id: StepId;
	label: string;
	href: string;
	state: StepState;
	/** Why a blocked step waits; null otherwise. */
	hint: string | null;
}

interface StepRule {
	id: StepId;
	label: string;
	/** Reachable. */
	open: (f: FlowFacts) => boolean;
	/** Passed. */
	done: (f: FlowFacts) => boolean;
	hint: string;
}

const RULES: readonly StepRule[] = [
	{ id: 'connect', label: 'Connect', open: () => true, done: (f) => f.connected, hint: '' },
	{ id: 'template', label: 'Template', open: (f) => f.connected, done: (f) => f.connected && f.templatePicked, hint: 'Connect to Flow PT first.' },
	{
		id: 'entities',
		label: 'Entities',
		open: (f) => f.connected && f.templatePicked,
		done: (f) => f.connected && f.planned,
		hint: 'Pick a project, type and template first.'
	},
	{
		id: 'plan',
		label: 'Plan',
		open: (f) => f.connected && f.planned,
		done: (f) => f.connected && f.runStarted,
		hint: 'Choose the entities, then Next builds the plan.'
	},
	{
		id: 'apply',
		label: 'Apply',
		open: (f) => f.connected && (f.planned || f.runStarted),
		done: (f) => f.connected && f.runStarted && f.runFinished,
		hint: 'Review the plan first.'
	},
	// Undo from a file needs only a site, so Result opens with the connection.
	{ id: 'result', label: 'Result', open: (f) => f.connected, done: () => false, hint: 'Connect to Flow PT first.' }
];

export function flowSteps(pathname: string, facts: FlowFacts): FlowStep[] {
	return RULES.map((rule) => {
		const href = `/${rule.id}`;
		const current = pathname === href || pathname.startsWith(`${href}/`);
		const open = rule.open(facts);
		const state: StepState = current ? 'current' : !open ? 'blocked' : rule.done(facts) ? 'done' : 'open';
		return { id: rule.id, label: rule.label, href, state, hint: state === 'blocked' ? rule.hint : null };
	});
}

/** A step screen is on show. Home and How it works are outside the flow: the shell hides the steps there. */
export function inFlow(steps: readonly FlowStep[]): boolean {
	return steps.some((s) => s.state === 'current');
}
