import { describe, expect, it } from 'vitest';
import { flowSteps, inFlow, type FlowFacts } from './flow';

const NONE: FlowFacts = { connected: false, templatePicked: false, planned: false, runStarted: false, runFinished: false };
const states = (path: string, facts: Partial<FlowFacts>) => flowSteps(path, { ...NONE, ...facts }).map((s) => `${s.id}:${s.state}`);

describe('flowSteps', () => {
	it('lists the six screens in order with their hrefs', () => {
		expect(flowSteps('/connect', NONE).map((s) => [s.id, s.label, s.href])).toEqual([
			['connect', 'Connect', '/connect'],
			['template', 'Template', '/template'],
			['entities', 'Entities', '/entities'],
			['plan', 'Plan', '/plan'],
			['apply', 'Apply', '/apply'],
			['result', 'Result', '/result']
		]);
	});

	it('before a site: connect is current, everything after is blocked with the reason', () => {
		const steps = flowSteps('/connect', NONE);
		expect(steps.map((s) => s.state)).toEqual(['current', 'blocked', 'blocked', 'blocked', 'blocked', 'blocked']);
		expect(steps[1].hint).toBe('Connect to Flow PT first.');
	});

	it('connected on template: connect done, template current, entities waits on a template', () => {
		expect(states('/template', { connected: true })).toEqual([
			'connect:done',
			'template:current',
			'entities:blocked',
			'plan:blocked',
			'apply:blocked',
			'result:open'
		]);
		expect(flowSteps('/template', { ...NONE, connected: true })[2].hint).toBe('Pick a project, type and template first.');
	});

	it('a template picked opens entities; plan and apply wait on a built plan', () => {
		const steps = flowSteps('/entities', { ...NONE, connected: true, templatePicked: true });
		expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'blocked', 'blocked', 'open']);
		expect(steps[3].hint).toBe('Choose the entities, then Next builds the plan.');
	});

	it('a built plan: entities done, plan and apply open', () => {
		expect(states('/plan', { connected: true, templatePicked: true, planned: true })).toEqual([
			'connect:done',
			'template:done',
			'entities:done',
			'plan:current',
			'apply:open',
			'result:open'
		]);
	});

	it('a run started marks plan done; finished marks apply done', () => {
		expect(states('/apply', { connected: true, templatePicked: true, planned: true, runStarted: true })).toContain('plan:done');
		expect(states('/result', { connected: true, templatePicked: true, planned: true, runStarted: true, runFinished: true })).toEqual([
			'connect:done',
			'template:done',
			'entities:done',
			'plan:done',
			'apply:done',
			'result:current'
		]);
	});

	it('the current screen wins over done and blocked, and a path below it counts', () => {
		expect(states('/plan/x', { connected: true, templatePicked: true, planned: true, runStarted: true })[3]).toBe('plan:current');
		expect(states('/apply', { connected: true })[4]).toBe('apply:current');
	});

	it('an unknown path has no current step', () => {
		expect(flowSteps('/live/x', NONE).some((s) => s.state === 'current')).toBe(false);
	});

	it('home and how it works are outside the flow: no step is current', () => {
		for (const path of ['/', '/how']) {
			expect(flowSteps(path, { ...NONE, connected: true }).some((s) => s.state === 'current')).toBe(false);
		}
	});

	it('result is open once connected: undo from a file needs only a site', () => {
		expect(flowSteps('/connect', { ...NONE, connected: true })[5].state).toBe('open');
	});
});

describe('inFlow', () => {
	it('is true on a step screen and its sub-paths', () => {
		expect(inFlow(flowSteps('/plan', NONE))).toBe(true);
		expect(inFlow(flowSteps('/result/abc', NONE))).toBe(true);
	});

	it('is false outside the flow: home and how it works', () => {
		expect(inFlow(flowSteps('/', NONE))).toBe(false);
		expect(inFlow(flowSteps('/how', NONE))).toBe(false);
	});
});
